// SPDX-License-Identifier: MPL-2.0

import {
  ALARM_NAME,
  FAST_TIMER_THRESHOLD_MS,
  LOAD_TIMEOUT_MS,
  MIN_ROTATION_SECONDS,
  NORMAL_POOL_SIZE,
  PREFLIGHT_TIMEOUT_MS,
  SCREEN_STATUS
} from "../core/constants.js";
import {
  getLists,
  getRecovery,
  getRuntime,
  saveRecovery,
  saveRuntime,
  updateScreenMetadata
} from "../core/storage.js";
import { detectPageState } from "../shared/naming.js";
import { syncActionState } from "./action-state.js";

let fastTimerId = null;

function modulo(value, length) {
  return ((value % length) + length) % length;
}

function unique(values) {
  return [...new Set(values)];
}

function validScreens(list) {
  return (list?.screens ?? []).filter((screen) => {
    if (screen.enabled === false) return false;
    try {
      const url = new URL(screen.url);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  });
}

async function getListById(listId) {
  const lists = await getLists();
  const list = lists.find((item) => item.id === listId);
  if (!list) throw new Error("Lista não encontrada.");
  const screens = validScreens(list);
  if (!screens.length) throw new Error("A lista não possui URLs válidas e habilitadas.");
  return { ...list, screens };
}

function durationFor(list, index) {
  const perScreen = list.screens[index]?.duration;
  const candidate = perScreen ?? list.defaultDuration ?? 30;
  const parsed = Number(candidate);
  return Math.max(MIN_ROTATION_SECONDS, Number.isFinite(parsed) ? parsed : 30);
}

function poolLimit(runtime, list) {
  const requested = runtime.paused ? Number(list.investigationPoolSize || 5) : NORMAL_POOL_SIZE;
  return Math.max(1, Math.min(list.screens.length, requested));
}

function desiredIndexes(runtime, list) {
  const n = list.screens.length;
  const limit = poolLimit(runtime, list);
  const offsets = [0, -1, 1, -2, 2, -3, 3];
  return unique(offsets.map((offset) => modulo(runtime.currentIndex + offset, n))).slice(0, limit);
}

function entryForIndex(runtime, index) {
  return (runtime.pool ?? []).find((entry) => entry.index === index) ?? null;
}

function entryForTab(runtime, tabId) {
  return (runtime.pool ?? []).find((entry) => entry.tabId === tabId) ?? null;
}

async function safeGetTab(tabId) {
  if (!Number.isInteger(tabId)) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function clearScheduler() {
  if (fastTimerId !== null) {
    clearTimeout(fastTimerId);
    fastTimerId = null;
  }
  await chrome.alarms.clear(ALARM_NAME);
}

async function persistRuntime(runtime, list = null) {
  await saveRuntime(runtime);
  if (runtime?.running) {
    await saveRecovery({
      listId: runtime.listId,
      currentIndex: runtime.currentIndex,
      wasRunning: true,
      updatedAt: Date.now()
    });
  }
  await syncActionState(runtime);
}

async function armDeadline(runtime) {
  await clearScheduler();
  if (!runtime?.running || runtime.paused || runtime.pendingJump || !runtime.nextRotationAt) return;

  const remaining = Math.max(0, runtime.nextRotationAt - Date.now());
  if (remaining < FAST_TIMER_THRESHOLD_MS) {
    fastTimerId = setTimeout(() => {
      fastTimerId = null;
      handleScheduledRotation().catch(console.error);
    }, remaining);
    // Recovery watchdog. Chrome will not actually deliver an alarm in under 30s.
    await chrome.alarms.create(ALARM_NAME, { when: Date.now() + FAST_TIMER_THRESHOLD_MS });
  } else {
    await chrome.alarms.create(ALARM_NAME, { when: runtime.nextRotationAt });
  }
}

async function scheduleNext(runtime, list) {
  if (!runtime.running || runtime.paused || runtime.pendingJump) {
    runtime.nextRotationAt = null;
    await persistRuntime(runtime, list);
    await clearScheduler();
    return;
  }

  runtime.nextRotationAt = Date.now() + durationFor(list, runtime.currentIndex) * 1000;
  await persistRuntime(runtime, list);
  await armDeadline(runtime);
}

async function waitForTabReady(tabId, timeoutMs = LOAD_TIMEOUT_MS) {
  const current = await safeGetTab(tabId);
  if (!current) return { ready: false, tab: null, reason: "closed" };
  if (current.status === "complete") return { ready: true, tab: current, reason: "complete" };

  return new Promise((resolve) => {
    let settled = false;
    const finish = async (ready, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve({ ready, tab: await safeGetTab(tabId), reason });
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish(true, "complete");
    };
    chrome.tabs.onUpdated.addListener(listener);
    const timeoutId = setTimeout(() => finish(false, "timeout"), timeoutMs);
  });
}

async function setEntryPageState(runtime, list, entry, tab) {
  if (!entry || !tab) return;
  const detected = detectPageState(tab.url || "", tab.title || "");
  entry.status = entry.tabId === runtime.currentTabId && detected === SCREEN_STATUS.READY
    ? SCREEN_STATUS.ACTIVE
    : detected;
  entry.title = tab.title || entry.title || "";
  entry.finalUrl = tab.url || entry.finalUrl || "";
  entry.lastUsedAt = entry.lastUsedAt || Date.now();

  const screen = list.screens[entry.index];
  if (screen) {
    await updateScreenMetadata(list.id, screen.id, {
      resolvedTitle: screen.name ? screen.resolvedTitle : (tab.title || screen.resolvedTitle || ""),
      lastStatus: detected,
      lastSeenAt: Date.now(),
      finalUrl: tab.url || ""
    });
  }
}

async function createPoolTab(runtime, list, index) {
  const screen = list.screens[index];
  const tab = await chrome.tabs.create({ windowId: runtime.windowId, url: screen.url, active: false });
  await chrome.tabs.update(tab.id, { autoDiscardable: false });
  const entry = {
    tabId: tab.id,
    index,
    status: SCREEN_STATUS.LOADING,
    title: "",
    finalUrl: screen.url,
    lastUsedAt: Date.now()
  };
  runtime.pool.push(entry);
  await persistRuntime(runtime, list);
  return entry;
}

function reusableEntry(runtime, protectedIndexes = new Set()) {
  const candidates = (runtime.pool ?? [])
    .filter((entry) => entry.tabId !== runtime.currentTabId && !protectedIndexes.has(entry.index))
    .sort((a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0));
  return candidates[0] ?? null;
}

async function reusePoolTab(runtime, list, entry, index) {
  const screen = list.screens[index];
  entry.index = index;
  entry.status = SCREEN_STATUS.LOADING;
  entry.title = "";
  entry.finalUrl = screen.url;
  entry.lastUsedAt = Date.now();
  await persistRuntime(runtime, list);
  await chrome.tabs.update(entry.tabId, {
    url: screen.url,
    active: false,
    autoDiscardable: false
  });
  return entry;
}

async function ensureIndexLoaded(runtime, list, index, protectedIndexes = new Set()) {
  let existing = entryForIndex(runtime, index);
  if (existing) {
    const tab = await safeGetTab(existing.tabId);
    if (tab) return existing;
    runtime.pool = runtime.pool.filter((entry) => entry.tabId !== existing.tabId);
  }

  const limit = poolLimit(runtime, list);
  if (runtime.pool.length < limit) {
    return createPoolTab(runtime, list, index);
  }

  const reusable = reusableEntry(runtime, protectedIndexes);
  if (reusable) return reusePoolTab(runtime, list, reusable, index);

  // Should be rare (e.g. a transient jump while all slots are protected).
  return createPoolTab(runtime, list, index);
}

async function closePoolEntry(runtime, list, entry) {
  runtime.intentionalCloseIds = unique([...(runtime.intentionalCloseIds ?? []), entry.tabId]);
  runtime.pool = runtime.pool.filter((item) => item.tabId !== entry.tabId);
  await persistRuntime(runtime, list);
  try {
    await chrome.tabs.remove(entry.tabId);
  } catch {
    // Already closed.
  }
}

async function trimPool(runtime, list, keepIndexes) {
  const limit = poolLimit(runtime, list);
  while (runtime.pool.length > limit) {
    const candidates = runtime.pool
      .filter((entry) => entry.tabId !== runtime.currentTabId && !keepIndexes.has(entry.index))
      .sort((a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0));
    const fallback = runtime.pool
      .filter((entry) => entry.tabId !== runtime.currentTabId)
      .sort((a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0));
    const entry = candidates[0] ?? fallback[0];
    if (!entry) break;
    await closePoolEntry(runtime, list, entry);
  }
}

async function rebalancePool(runtime, list) {
  const wanted = desiredIndexes(runtime, list);
  const protectedIndexes = new Set([runtime.currentIndex]);

  for (const index of wanted) {
    const entry = await ensureIndexLoaded(runtime, list, index, protectedIndexes);
    protectedIndexes.add(entry.index);
  }

  await trimPool(runtime, list, new Set(wanted));
  await persistRuntime(runtime, list);
  return runtime;
}

async function activateEntry(runtime, list, entry) {
  runtime.internalActivationTabId = entry.tabId;
  runtime.currentTabId = entry.tabId;
  runtime.currentIndex = entry.index;
  runtime.pool.forEach((item) => {
    if (item.status === SCREEN_STATUS.ACTIVE) item.status = SCREEN_STATUS.READY;
  });
  entry.lastUsedAt = Date.now();
  if (entry.status === SCREEN_STATUS.READY) entry.status = SCREEN_STATUS.ACTIVE;
  await persistRuntime(runtime, list);
  await chrome.tabs.update(entry.tabId, { active: true, autoDiscardable: false });
}

async function activateIndex(runtime, list, targetIndex, { wait = true, schedule = true } = {}) {
  const n = list.screens.length;
  targetIndex = modulo(targetIndex, n);
  const already = entryForIndex(runtime, targetIndex);

  if (!already || (await safeGetTab(already.tabId))?.status !== "complete") {
    runtime.pendingJump = { targetIndex, startedAt: Date.now() };
    runtime.nextRotationAt = null;
    await clearScheduler();
    await persistRuntime(runtime, list);
  }

  const protectedIndexes = new Set([runtime.currentIndex]);
  const entry = await ensureIndexLoaded(runtime, list, targetIndex, protectedIndexes);
  let loadResult = { ready: true, tab: await safeGetTab(entry.tabId), reason: "cached" };

  if (wait && loadResult.tab?.status !== "complete") {
    loadResult = await waitForTabReady(entry.tabId, LOAD_TIMEOUT_MS);
  }

  if (loadResult.tab) await setEntryPageState(runtime, list, entry, loadResult.tab);
  if (!loadResult.ready && loadResult.reason === "timeout") {
    entry.status = SCREEN_STATUS.ERROR;
    runtime.error = `A tela ${targetIndex + 1} excedeu ${Math.round(LOAD_TIMEOUT_MS / 1000)}s de carregamento.`;
  } else if (runtime.error?.startsWith("A tela ")) {
    runtime.error = null;
  }

  runtime.pendingJump = null;
  await activateEntry(runtime, list, entry);
  await rebalancePool(runtime, list);
  if (schedule && !runtime.paused) await scheduleNext(runtime, list);
  return runtime;
}

async function closeManagedTabs(runtime) {
  const ids = unique((runtime?.pool ?? []).map((entry) => entry.tabId).filter(Number.isInteger));
  if (!ids.length) return;
  try {
    await chrome.tabs.remove(ids);
  } catch {
    // One or more tabs may already be closed.
  }
}

export async function startList(listId, windowId, startIndex = 0) {
  const existing = await getRuntime();
  if (existing) {
    await clearScheduler();
    await closeManagedTabs(existing);
    await saveRuntime(null);
  }

  const list = await getListById(listId);
  const currentIndex = modulo(Number(startIndex) || 0, list.screens.length);
  const runtime = {
    running: true,
    paused: false,
    listId,
    windowId,
    currentIndex,
    currentTabId: null,
    pool: [],
    pendingJump: null,
    internalActivationTabId: null,
    intentionalCloseIds: [],
    nextRotationAt: null,
    startedAt: Date.now(),
    error: null
  };

  await persistRuntime(runtime, list);
  await rebalancePool(runtime, list);
  const current = entryForIndex(runtime, currentIndex);
  if (!current) throw new Error("Não foi possível preparar a tela inicial.");
  await activateEntry(runtime, list, current);
  await scheduleNext(runtime, list);
  return runtime;
}

export async function stopRotation() {
  const runtime = await getRuntime();
  await clearScheduler();
  if (runtime) await closeManagedTabs(runtime);
  await saveRuntime(null);
  await saveRecovery(null);
  await syncActionState(null);
  return null;
}

export async function pauseRotation() {
  const runtime = await getRuntime();
  if (!runtime) return null;
  const list = await getListById(runtime.listId);
  runtime.paused = true;
  runtime.nextRotationAt = null;
  runtime.pendingJump = null;
  await clearScheduler();
  await persistRuntime(runtime, list);
  await rebalancePool(runtime, list);
  return runtime;
}

export async function resumeRotation() {
  const runtime = await getRuntime();
  if (!runtime) return null;
  const list = await getListById(runtime.listId);
  runtime.paused = false;
  runtime.error = null;
  await persistRuntime(runtime, list);
  await rebalancePool(runtime, list);
  await scheduleNext(runtime, list);
  return runtime;
}

export async function nextScreen() {
  const runtime = await getRuntime();
  if (!runtime) return null;
  const list = await getListById(runtime.listId);
  return activateIndex(runtime, list, runtime.currentIndex + 1, { wait: true, schedule: true });
}

export async function previousScreen() {
  const runtime = await getRuntime();
  if (!runtime) return null;
  const list = await getListById(runtime.listId);
  return activateIndex(runtime, list, runtime.currentIndex - 1, { wait: true, schedule: true });
}

export async function jumpToScreen(targetIndex) {
  const runtime = await getRuntime();
  if (!runtime) return null;
  const list = await getListById(runtime.listId);
  targetIndex = Number(targetIndex);
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= list.screens.length) {
    throw new Error("Índice de tela inválido.");
  }
  return activateIndex(runtime, list, targetIndex, { wait: true, schedule: true });
}

export async function handleTabUpdated(tabId, changeInfo, tab) {
  const runtime = await getRuntime();
  if (!runtime) return;
  const entry = entryForTab(runtime, tabId);
  if (!entry) return;
  const list = await getListById(runtime.listId);

  if (changeInfo.status === "loading") entry.status = SCREEN_STATUS.LOADING;
  if (changeInfo.status === "complete" || changeInfo.title || changeInfo.url) {
    const fresh = tab ?? await safeGetTab(tabId);
    if (fresh) await setEntryPageState(runtime, list, entry, fresh);
  }
  await persistRuntime(runtime, list);
}

export async function handleTabActivated(tabId) {
  const runtime = await getRuntime();
  if (!runtime) return;

  if (runtime.internalActivationTabId === tabId) {
    runtime.internalActivationTabId = null;
    await saveRuntime(runtime);
    return;
  }

  if (!runtime.paused || runtime.pendingJump) return;
  const entry = entryForTab(runtime, tabId);
  if (!entry) return;

  const list = await getListById(runtime.listId);
  runtime.currentIndex = entry.index;
  runtime.currentTabId = entry.tabId;
  runtime.pool.forEach((item) => {
    if (item.status === SCREEN_STATUS.ACTIVE) item.status = SCREEN_STATUS.READY;
  });
  entry.status = entry.status === SCREEN_STATUS.READY ? SCREEN_STATUS.ACTIVE : entry.status;
  entry.lastUsedAt = Date.now();
  await persistRuntime(runtime, list);
  await rebalancePool(runtime, list);
}

export async function handleManagedTabClosed(tabId) {
  const runtime = await getRuntime();
  if (!runtime) return;

  if ((runtime.intentionalCloseIds ?? []).includes(tabId)) {
    runtime.intentionalCloseIds = runtime.intentionalCloseIds.filter((id) => id !== tabId);
    await saveRuntime(runtime);
    return;
  }

  const entry = entryForTab(runtime, tabId);
  if (!entry) return;
  const wasCurrent = runtime.currentTabId === tabId;
  runtime.pool = runtime.pool.filter((item) => item.tabId !== tabId);
  runtime.currentTabId = wasCurrent ? null : runtime.currentTabId;

  try {
    const list = await getListById(runtime.listId);
    await persistRuntime(runtime, list);
    await rebalancePool(runtime, list);
    if (wasCurrent) {
      const replacement = entryForIndex(runtime, runtime.currentIndex);
      if (replacement) await activateEntry(runtime, list, replacement);
    }
  } catch (error) {
    runtime.error = `Falha ao reconstruir uma aba gerenciada: ${error.message}`;
    await persistRuntime(runtime);
  }
}

async function handleScheduledRotation() {
  const runtime = await getRuntime();
  if (!runtime?.running || runtime.paused || runtime.pendingJump) return;
  if (runtime.nextRotationAt && Date.now() + 250 < runtime.nextRotationAt) {
    await armDeadline(runtime);
    return;
  }
  const list = await getListById(runtime.listId);
  await activateIndex(runtime, list, runtime.currentIndex + 1, { wait: true, schedule: true });
}

export async function handleAlarm(alarm) {
  if (alarm.name !== ALARM_NAME) return;
  await handleScheduledRotation();
}

export async function recoverScheduler() {
  const runtime = await getRuntime();
  if (runtime && !Array.isArray(runtime.pool)) {
    const legacyIds = unique(Object.values(runtime.slots ?? {}).filter(Number.isInteger));
    try { if (legacyIds.length) await chrome.tabs.remove(legacyIds); } catch { /* no-op */ }
    await saveRuntime(null);
    await saveRecovery(null);
    await syncActionState(null);
    return;
  }
  await syncActionState(runtime);
  if (!runtime?.running) return;
  if (runtime.pendingJump) {
    try {
      const list = await getListById(runtime.listId);
      await activateIndex(runtime, list, runtime.pendingJump.targetIndex, { wait: true, schedule: true });
    } catch (error) {
      runtime.error = `Falha ao recuperar uma navegação pendente: ${error.message}`;
      runtime.pendingJump = null;
      await persistRuntime(runtime);
    }
    return;
  }
  if (runtime.paused) return;
  if (!runtime.nextRotationAt) {
    const list = await getListById(runtime.listId);
    await scheduleNext(runtime, list);
    return;
  }
  await armDeadline(runtime);
}

export async function recoverBrowserSession() {
  const runtime = await getRuntime();
  if (runtime) return recoverScheduler();
  const recovery = await getRecovery();
  if (!recovery?.wasRunning) return;
  const lists = await getLists();
  const list = lists.find((item) => item.id === recovery.listId);
  if (!list?.autoResume) return;
  const currentWindow = await chrome.windows.getLastFocused();
  if (!currentWindow?.id) return;
  await startList(recovery.listId, currentWindow.id, recovery.currentIndex ?? 0);
}

export async function preflightList(listId, windowId) {
  const list = await getListById(listId);
  const results = [];
  const tab = await chrome.tabs.create({ windowId, url: "about:blank", active: false });
  try {
    for (let index = 0; index < list.screens.length; index += 1) {
      const screen = list.screens[index];
      await chrome.tabs.update(tab.id, { url: screen.url, active: false });
      const loaded = await waitForTabReady(tab.id, PREFLIGHT_TIMEOUT_MS);
      const fresh = loaded.tab ?? await safeGetTab(tab.id);
      const status = !loaded.ready && loaded.reason === "timeout"
        ? SCREEN_STATUS.ERROR
        : detectPageState(fresh?.url || screen.url, fresh?.title || "");
      const resolvedTitle = fresh?.title || screen.resolvedTitle || "";
      await updateScreenMetadata(list.id, screen.id, {
        resolvedTitle: screen.name ? screen.resolvedTitle : resolvedTitle,
        lastStatus: status,
        lastSeenAt: Date.now(),
        finalUrl: fresh?.url || screen.url
      });
      results.push({
        index,
        screenId: screen.id,
        status,
        title: resolvedTitle,
        finalUrl: fresh?.url || screen.url
      });
    }
  } finally {
    try { await chrome.tabs.remove(tab.id); } catch { /* no-op */ }
  }
  return results;
}

export async function togglePause() {
  const runtime = await getRuntime();
  if (!runtime) return null;
  return runtime.paused ? resumeRotation() : pauseRotation();
}

export async function getPublicState() {
  const runtime = await getRuntime();
  if (!runtime) return { runtime: null, list: null };

  try {
    const list = await getListById(runtime.listId);
    return { runtime, list };
  } catch (error) {
    const broken = { ...runtime, error: error.message };
    await syncActionState(broken);
    return { runtime: broken, list: null };
  }
}
