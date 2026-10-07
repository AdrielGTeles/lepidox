// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

import {
  ALARM_NAME,
  LOAD_TIMEOUT_MS,
  NORMAL_POOL_SIZE,
  SCREEN_STATUS
} from "../core/constants.js";
import { effectiveDuration, rotationScreens } from "../core/lists.js";
import {
  getLists,
  getRecovery,
  getRuntime,
  getScreenMeta,
  patchScreenMeta,
  pruneScreenMeta,
  saveRecovery,
  saveRuntime
} from "../core/storage.js";
import { t } from "../shared/i18n.js";
import { detectPageState, screenTitle } from "../shared/naming.js";
import { syncActionState } from "./action-state.js";
import { exclusive } from "./lock.js";
import { armDeadline, clearScheduler } from "./scheduler.js";
import { removeTabsKeepingWindow, safeGetTab, waitForTabReady } from "./tabs.js";

// Everything exported from this module takes the lock itself. Helpers below the
// exports assume the caller already holds it and must never call an export.

function modulo(value, length) {
  return ((value % length) + length) % length;
}

function unique(values) {
  return [...new Set(values)];
}

export async function loadRotationList(listId) {
  const list = (await getLists()).find((item) => item.id === listId);
  if (!list) throw new Error(t("errorListNotFound"));
  const screens = rotationScreens(list);
  if (!screens.length) throw new Error(t("errorNoValidScreens"));
  return { ...list, screens };
}

async function loadContext() {
  const runtime = await getRuntime();
  if (!runtime) return null;
  return { runtime, list: await loadRotationList(runtime.listId) };
}

function poolLimit(runtime, list) {
  const requested = runtime.paused ? list.investigationPoolSize : NORMAL_POOL_SIZE;
  return Math.max(1, Math.min(list.screens.length, requested));
}

// Current first, then next before previous, so the upcoming screen preloads first.
function desiredIndexes(runtime, list) {
  const offsets = [0, 1, -1, 2, -2, 3, -3];
  return unique(offsets.map((offset) => modulo(runtime.currentIndex + offset, list.screens.length)))
    .slice(0, poolLimit(runtime, list));
}

function entryForScreen(runtime, screenId) {
  return runtime.pool.find((entry) => entry.screenId === screenId) ?? null;
}

function entryForTab(runtime, tabId) {
  return runtime.pool.find((entry) => entry.tabId === tabId) ?? null;
}

function poolTabIds(runtime) {
  return unique((runtime?.pool ?? []).map((entry) => entry.tabId).filter(Number.isInteger));
}

async function persist(runtime) {
  await saveRuntime(runtime);
  await syncActionState(runtime);
}

async function schedule(runtime, list) {
  if (runtime.paused || runtime.pendingJump || list.screens.length < 2) {
    runtime.nextRotationAt = null;
    runtime.rotationMs = null;
    await clearScheduler();
    await persist(runtime);
    return;
  }

  runtime.rotationMs = effectiveDuration(list, list.screens[runtime.currentIndex]) * 1000;
  runtime.nextRotationAt = Date.now() + runtime.rotationMs;
  await persist(runtime);
  await armDeadline(runtime.nextRotationAt, handleScheduledRotation);
}

// Returns true when the entry changed.
function applyTabState(entry, tab) {
  const loaded = tab.status === "complete";
  const status = loaded ? detectPageState(tab.url || "", tab.title || "", entry.url) : SCREEN_STATUS.LOADING;
  // While loading, the tab title is just the address; keep the last real one.
  const title = loaded && tab.title ? tab.title : entry.title;
  const finalUrl = tab.url || entry.finalUrl;
  if (entry.status === status && entry.title === title && entry.finalUrl === finalUrl) return false;
  Object.assign(entry, { status, title, finalUrl });
  return true;
}

async function rememberScreen(entry) {
  if (entry.status === SCREEN_STATUS.LOADING) return;
  const patch = { status: entry.status, finalUrl: entry.finalUrl };
  // A sign-in or error page title must not become the screen's automatic name.
  if (entry.status === SCREEN_STATUS.READY) patch.title = entry.title;
  await patchScreenMeta({ [entry.screenId]: patch });
}

function newEntry(tabId, screen, index) {
  return {
    tabId,
    screenId: screen.id,
    index,
    url: screen.url,
    status: SCREEN_STATUS.LOADING,
    title: "",
    finalUrl: screen.url,
    lastUsedAt: Date.now()
  };
}

async function createPoolTab(runtime, list, index) {
  const screen = list.screens[index];
  const tab = await chrome.tabs.create({ windowId: runtime.windowId, url: screen.url, active: false });
  await chrome.tabs.update(tab.id, { autoDiscardable: false });
  const entry = newEntry(tab.id, screen, index);
  runtime.pool.push(entry);
  await persist(runtime);
  return entry;
}

async function repointEntry(runtime, list, entry, index) {
  const screen = list.screens[index];
  Object.assign(entry, newEntry(entry.tabId, screen, index));
  await persist(runtime);
  await chrome.tabs.update(entry.tabId, { url: screen.url, autoDiscardable: false });
  return entry;
}

function oldestEntries(runtime, keepIds) {
  return runtime.pool
    .filter((entry) => entry.tabId !== runtime.currentTabId && !keepIds.has(entry.screenId))
    .sort((a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0));
}

async function ensureLoaded(runtime, list, index, keepIds) {
  const screen = list.screens[index];
  const existing = entryForScreen(runtime, screen.id);
  if (existing) {
    if (await safeGetTab(existing.tabId)) {
      existing.index = index;
      return existing;
    }
    runtime.pool = runtime.pool.filter((entry) => entry !== existing);
  }

  if (runtime.pool.length >= poolLimit(runtime, list)) {
    const reusable = oldestEntries(runtime, keepIds)[0];
    if (reusable) return repointEntry(runtime, list, reusable, index);
  }
  return createPoolTab(runtime, list, index);
}

async function closeEntry(runtime, entry) {
  runtime.intentionalCloseIds = unique([...runtime.intentionalCloseIds, entry.tabId]);
  runtime.pool = runtime.pool.filter((item) => item !== entry);
  await persist(runtime);
  try {
    await chrome.tabs.remove(entry.tabId);
  } catch {
    // Already closed.
  }
}

async function rebalance(runtime, list) {
  const wanted = desiredIndexes(runtime, list);
  const keepIds = new Set(wanted.map((index) => list.screens[index].id));
  // A screen still loading for a pending jump must not be recycled under it.
  if (runtime.pendingJump) keepIds.add(runtime.pendingJump.screenId);
  for (const index of wanted) await ensureLoaded(runtime, list, index, keepIds);

  while (runtime.pool.length > poolLimit(runtime, list)) {
    const extra = oldestEntries(runtime, keepIds)[0];
    if (!extra) break;
    await closeEntry(runtime, extra);
  }
  await persist(runtime);
}

async function activateEntry(runtime, list, entry) {
  runtime.currentTabId = entry.tabId;
  runtime.currentIndex = entry.index;
  entry.lastUsedAt = Date.now();

  const tab = await safeGetTab(entry.tabId);
  const needsSwitch = Boolean(tab) && !tab.active;
  // Lets handleTabActivated tell our own switch apart from the user's.
  if (needsSwitch) runtime.internalActivationTabId = entry.tabId;
  await persist(runtime);
  if (needsSwitch) await chrome.tabs.update(entry.tabId, { active: true });

  if (list.autoResume) {
    await saveRecovery({
      listId: runtime.listId,
      screenId: entry.screenId,
      wasRunning: true,
      updatedAt: Date.now()
    });
  }
}

async function showEntry(runtime, list, entry) {
  await activateEntry(runtime, list, entry);
  await rebalance(runtime, list);
  // rebalance replaces an entry whose tab died in the meantime.
  const shown = entryForScreen(runtime, entry.screenId);
  if (shown && shown.tabId !== runtime.currentTabId) await activateEntry(runtime, list, shown);
  await schedule(runtime, list);
  await rememberScreen(shown ?? entry);
}

// Next/previous count from the screen being loaded, so pressing twice skips two.
function anchorIndex(runtime, list) {
  const pending = runtime.pendingJump
    ? list.screens.findIndex((screen) => screen.id === runtime.pendingJump.screenId)
    : -1;
  return pending >= 0 ? pending : runtime.currentIndex;
}

// pickIndex(runtime, list) returns the target index, or null to do nothing.
// Waiting for a page to load happens outside the lock so pause/stop stay responsive.
async function goTo(pickIndex) {
  const jump = await exclusive(async () => {
    const context = await loadContext();
    if (!context) return null;
    const { runtime, list } = context;
    const target = pickIndex(runtime, list);
    if (target === null) return null;

    const index = modulo(target, list.screens.length);
    const keepIds = new Set([list.screens[runtime.currentIndex]?.id, list.screens[index].id]);
    const entry = await ensureLoaded(runtime, list, index, keepIds);
    const tab = await safeGetTab(entry.tabId);

    if (tab?.status === "complete") {
      runtime.pendingJump = null;
      applyTabState(entry, tab);
      await showEntry(runtime, list, entry);
      return null;
    }

    runtime.pendingJump = {
      id: crypto.randomUUID(),
      screenId: entry.screenId,
      tabId: entry.tabId,
      startedAt: Date.now()
    };
    runtime.nextRotationAt = null;
    runtime.rotationMs = null;
    await clearScheduler();
    await persist(runtime);
    return runtime.pendingJump;
  });

  if (jump) await finishJump(jump);
}

async function finishJump(jump) {
  const loaded = await waitForTabReady(jump.tabId, LOAD_TIMEOUT_MS);

  await exclusive(async () => {
    const context = await loadContext();
    // Stopped, or a newer jump took over while this one was loading.
    if (!context || context.runtime.pendingJump?.id !== jump.id) return;
    const { runtime, list } = context;
    runtime.pendingJump = null;

    const index = list.screens.findIndex((screen) => screen.id === jump.screenId);
    const entry = entryForTab(runtime, jump.tabId);
    if (index < 0 || entry?.screenId !== jump.screenId || !loaded.tab) {
      // The target vanished while loading: stay on the current screen.
      await rebalance(runtime, list);
      await schedule(runtime, list);
      return;
    }

    entry.index = index;
    if (loaded.reason === "timeout") {
      entry.status = SCREEN_STATUS.ERROR;
      runtime.error = {
        kind: "timeout",
        message: t("errorScreenTimeout", index + 1, Math.round(LOAD_TIMEOUT_MS / 1000))
      };
    } else {
      applyTabState(entry, loaded.tab);
      if (runtime.error?.kind === "timeout") runtime.error = null;
    }
    await showEntry(runtime, list, entry);
  });
}

async function handleScheduledRotation() {
  let rearmAt = null;
  await goTo((runtime) => {
    if (runtime.paused || runtime.pendingJump || !runtime.nextRotationAt) return null;
    if (Date.now() + 250 < runtime.nextRotationAt) {
      rearmAt = runtime.nextRotationAt;
      return null;
    }
    return runtime.currentIndex + 1;
  });
  if (rearmAt) await armDeadline(rearmAt, handleScheduledRotation);
}

async function teardown(runtime, { keepRecovery = false, closeTabs = true } = {}) {
  await clearScheduler();
  await saveRuntime(null);
  if (!keepRecovery) await saveRecovery(null);
  await syncActionState(null);
  if (closeTabs && runtime) await removeTabsKeepingWindow(runtime.windowId, poolTabIds(runtime));
}

export function startList(listId, windowId, startIndex = 0) {
  return exclusive(async () => {
    // Validate first: a list that cannot start must not end the one that is running.
    const list = await loadRotationList(listId);
    const previous = await getRuntime();
    await clearScheduler();

    const runtime = {
      running: true,
      paused: false,
      listId,
      windowId,
      currentIndex: modulo(Number(startIndex) || 0, list.screens.length),
      currentTabId: null,
      pool: [],
      pendingJump: null,
      internalActivationTabId: null,
      intentionalCloseIds: [],
      nextRotationAt: null,
      rotationMs: null,
      startedAt: Date.now(),
      error: null
    };

    try {
      await persist(runtime);
      await rebalance(runtime, list);
      const first = entryForScreen(runtime, list.screens[runtime.currentIndex].id);
      if (!first) throw new Error(t("errorStartFailed"));
      await activateEntry(runtime, list, first);
      await schedule(runtime, list);
    } catch (error) {
      await teardown(runtime);
      if (previous) await removeTabsKeepingWindow(previous.windowId, poolTabIds(previous));
      throw error;
    }

    // The previous session's tabs go last so the window is never left empty.
    if (previous) await removeTabsKeepingWindow(previous.windowId, poolTabIds(previous));
  });
}

export function stopRotation() {
  return exclusive(async () => teardown(await getRuntime()));
}

export function pauseRotation() {
  return exclusive(async () => {
    const context = await loadContext();
    if (!context) return;
    const { runtime, list } = context;
    runtime.paused = true;
    await schedule(runtime, list);
    // A paused session keeps more neighbours loaded for quick manual browsing.
    await rebalance(runtime, list);
  });
}

export function resumeRotation() {
  return exclusive(async () => {
    const context = await loadContext();
    if (!context) return;
    const { runtime, list } = context;
    runtime.paused = false;
    runtime.error = null;
    await rebalance(runtime, list);
    await schedule(runtime, list);
  });
}

export async function togglePause() {
  const runtime = await getRuntime();
  if (!runtime) return;
  await (runtime.paused ? resumeRotation() : pauseRotation());
}

export function nextScreen() {
  return goTo((runtime, list) => anchorIndex(runtime, list) + 1);
}

export function previousScreen() {
  return goTo((runtime, list) => anchorIndex(runtime, list) - 1);
}

export function jumpToScreen(targetIndex) {
  return goTo((_runtime, list) => {
    const index = Number(targetIndex);
    if (!Number.isInteger(index) || index < 0 || index >= list.screens.length) {
      throw new Error(t("errorInvalidScreen"));
    }
    return index;
  });
}

export function handleTabUpdated(tabId, changeInfo, tab) {
  if (!changeInfo.status && !changeInfo.title && !changeInfo.url) return Promise.resolve();
  return exclusive(async () => {
    const runtime = await getRuntime();
    const entry = runtime && entryForTab(runtime, tabId);
    if (!entry) return;
    const fresh = tab ?? await safeGetTab(tabId);
    if (!fresh || !applyTabState(entry, fresh)) return;
    await persist(runtime);
    await rememberScreen(entry);
  });
}

export function handleTabActivated(tabId) {
  return exclusive(async () => {
    const runtime = await getRuntime();
    if (!runtime) return;

    if (runtime.internalActivationTabId === tabId) {
      runtime.internalActivationTabId = null;
      await saveRuntime(runtime);
      return;
    }

    // While paused, clicking a managed tab moves the session to that screen.
    if (!runtime.paused || runtime.pendingJump) return;
    const entry = entryForTab(runtime, tabId);
    if (!entry) return;

    const list = await loadRotationList(runtime.listId);
    runtime.currentIndex = entry.index;
    runtime.currentTabId = entry.tabId;
    entry.lastUsedAt = Date.now();
    await rebalance(runtime, list);
  });
}

export function handleTabRemoved(tabId, removeInfo) {
  return exclusive(async () => {
    const runtime = await getRuntime();
    if (!runtime) return;

    if (runtime.intentionalCloseIds.includes(tabId)) {
      runtime.intentionalCloseIds = runtime.intentionalCloseIds.filter((id) => id !== tabId);
      await saveRuntime(runtime);
      return;
    }

    const entry = entryForTab(runtime, tabId);
    if (!entry) return;

    if (removeInfo?.isWindowClosing) {
      // Usually the browser quitting. Keep the recovery record so an auto-resume
      // list comes back on the next start; only an explicit stop clears it.
      await teardown(runtime, { keepRecovery: true, closeTabs: false });
      return;
    }

    const wasCurrent = runtime.currentTabId === tabId;
    runtime.pool = runtime.pool.filter((item) => item !== entry);
    if (wasCurrent) runtime.currentTabId = null;

    try {
      const list = await loadRotationList(runtime.listId);
      await rebalance(runtime, list);
      if (wasCurrent) {
        const replacement = entryForScreen(runtime, list.screens[runtime.currentIndex].id);
        if (replacement) await activateEntry(runtime, list, replacement);
      }
    } catch (error) {
      runtime.error = { kind: "rebuild", message: t("errorRebuildFailed", error.message) };
      await persist(runtime);
    }
  });
}

// The options page saves as the user edits, so a running session has to follow
// its list: screens are matched by id, never by position.
export function handleListsChanged() {
  return exclusive(async () => {
    await pruneScreenMeta(await getLists());
    const runtime = await getRuntime();
    if (!runtime) return;

    let list;
    try {
      list = await loadRotationList(runtime.listId);
    } catch {
      // The list was deleted or has nothing left to show.
      await teardown(runtime);
      return;
    }

    const indexById = new Map(list.screens.map((screen, index) => [screen.id, index]));
    const current = entryForTab(runtime, runtime.currentTabId);
    let currentIsStale = !current;

    for (const entry of [...runtime.pool]) {
      const index = indexById.get(entry.screenId);
      if (index !== undefined && list.screens[index].url === entry.url) {
        entry.index = index;
      } else if (entry === current) {
        currentIsStale = true;
      } else {
        await closeEntry(runtime, entry);
      }
    }

    if (currentIsStale) {
      // The screen on display was removed, disabled or pointed elsewhere:
      // show whatever now sits at that position.
      runtime.currentIndex = Math.min(runtime.currentIndex, list.screens.length - 1);
      const replacementId = list.screens[runtime.currentIndex].id;
      const replacement = runtime.pool.find((entry) => entry !== current && entry.screenId === replacementId);
      if (current && !replacement) {
        await repointEntry(runtime, list, current, runtime.currentIndex);
      } else if (current) {
        await activateEntry(runtime, list, replacement);
        await closeEntry(runtime, current);
      }
    } else {
      runtime.currentIndex = current.index;
    }

    if (runtime.pendingJump && !indexById.has(runtime.pendingJump.screenId)) runtime.pendingJump = null;

    await rebalance(runtime, list);
    const shown = entryForScreen(runtime, list.screens[runtime.currentIndex].id);
    if (shown && shown.tabId !== runtime.currentTabId) await activateEntry(runtime, list, shown);

    const waiting = !runtime.nextRotationAt && !runtime.paused && !runtime.pendingJump;
    if (waiting || list.screens.length < 2) await schedule(runtime, list);
    else await persist(runtime);
  });
}

export async function handleAlarm(alarm) {
  if (alarm.name !== ALARM_NAME) return;
  await handleScheduledRotation();
}

// Runs every time the service worker starts: timers do not survive a suspension.
export async function recoverScheduler() {
  const jump = await exclusive(async () => {
    const runtime = await getRuntime();
    await syncActionState(runtime);
    if (!runtime) return null;
    if (runtime.pendingJump) return runtime.pendingJump;
    if (runtime.paused) return null;
    if (!runtime.nextRotationAt) {
      await schedule(runtime, await loadRotationList(runtime.listId));
      return null;
    }
    await armDeadline(runtime.nextRotationAt, handleScheduledRotation);
    return null;
  });

  if (jump) await finishJump(jump);
}

export async function recoverBrowserSession() {
  if (await getRuntime()) return;
  const recovery = await getRecovery();
  if (!recovery?.wasRunning) return;

  const list = (await getLists()).find((item) => item.id === recovery.listId);
  if (!list?.autoResume) {
    await saveRecovery(null);
    return;
  }

  const currentWindow = await chrome.windows.getLastFocused();
  if (!currentWindow?.id) return;
  const startIndex = rotationScreens(list).findIndex((screen) => screen.id === recovery.screenId);
  await startList(list.id, currentWindow.id, Math.max(0, startIndex));
}

// What the popup and options page render. Read-only, so it does not take the lock.
export async function getPublicState() {
  const runtime = await getRuntime();
  if (!runtime) return null;

  const state = {
    listId: runtime.listId,
    listName: "",
    paused: runtime.paused,
    loading: Boolean(runtime.pendingJump),
    currentIndex: runtime.currentIndex,
    nextRotationAt: runtime.nextRotationAt,
    rotationMs: runtime.rotationMs,
    error: runtime.error?.message ?? null,
    screens: []
  };

  let list;
  try {
    list = await loadRotationList(runtime.listId);
  } catch (error) {
    return { ...state, error: error.message };
  }

  const meta = await getScreenMeta();
  state.listName = list.name;
  state.screens = list.screens.map((screen, index) => {
    const entry = entryForScreen(runtime, screen.id);
    const known = meta[screen.id] ?? {};
    const observedTitle = entry?.status === SCREEN_STATUS.READY && entry.title ? entry.title : known.title;
    const lastProblem = [SCREEN_STATUS.AUTH, SCREEN_STATUS.ERROR].includes(known.status) ? known.status : SCREEN_STATUS.COLD;
    return {
      id: screen.id,
      url: screen.url,
      title: screenTitle(screen, index, observedTitle),
      duration: effectiveDuration(list, screen),
      status: entry ? entry.status : lastProblem
    };
  });
  return state;
}
