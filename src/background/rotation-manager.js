// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

import {
  ALARM_NAME,
  LOAD_TIMEOUT_MS,
  NAVIGATION_ABORTED,
  NORMAL_POOL_SIZE,
  RECOVERY_VERSION,
  RESTORE_POLL_MS,
  RESTORE_SETTLE_MS,
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
import { syncKeepAwake } from "./keep-awake.js";
import { exclusive } from "./lock.js";
import { armDeadline, clearScheduler } from "./scheduler.js";
import { releaseWindow, safeGetTab, waitForTabReady } from "./tabs.js";

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
  syncKeepAwake(runtime);
}

async function schedule(runtime, list) {
  if (runtime.paused || runtime.pendingJump || list.screens.length < 2) {
    runtime.nextRotationAt = null;
    runtime.rotationMs = null;
    await clearScheduler();
    await persist(runtime);
    await rememberSession(runtime);
    return;
  }

  runtime.rotationMs = effectiveDuration(list, list.screens[runtime.currentIndex]) * 1000;
  runtime.nextRotationAt = Date.now() + runtime.rotationMs;
  await persist(runtime);
  await armDeadline(runtime.nextRotationAt, handleScheduledRotation);
  await rememberSession(runtime);
}

// The session storage does not survive an update or a restart. This record, kept in
// local storage, says where the session was and which tabs it owned, at the address
// each one shows: that is what a restored session brings back. A tab still opening has
// only a pending address.
async function rememberSession(runtime) {
  const tabs = await chrome.tabs.query({ windowId: runtime.windowId }).catch(() => []);
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const address = (tab) => tab.url || tab.pendingUrl || "";
  await saveRecovery({
    version: RECOVERY_VERSION,
    listId: runtime.listId,
    screenId: entryForTab(runtime, runtime.currentTabId)?.screenId ?? null,
    windowId: runtime.windowId,
    ownWindow: Boolean(runtime.ownWindow),
    paused: runtime.paused,
    live: true,
    tabs: runtime.pool
      .filter((entry) => byId.has(entry.tabId))
      .map((entry) => ({ tabId: entry.tabId, screenId: entry.screenId, index: byId.get(entry.tabId).index, url: address(byId.get(entry.tabId)) })),
    updatedAt: Date.now()
  });
}

async function forgetSession({ keepForRestart }) {
  const recovery = await getRecovery();
  await saveRecovery(keepForRestart && recovery ? { ...recovery, live: false } : null);
}

// Returns true when the entry changed.
function applyTabState(entry, tab) {
  const loaded = tab.status === "complete";
  const failed = entry.loadError ? SCREEN_STATUS.ERROR : null;
  const status = loaded ? failed ?? detectPageState(tab.url || "", entry.url) : SCREEN_STATUS.LOADING;
  // While loading, the tab title is just the address; keep the last real one.
  const title = loaded && tab.title ? tab.title : entry.title;
  const finalUrl = tab.url || entry.finalUrl;
  if (entry.status === status && entry.title === title && entry.finalUrl === finalUrl) return false;
  Object.assign(entry, { status, title, finalUrl });
  return true;
}

// Zoom is set per tab, so other tabs of the same site keep theirs. The browser resets
// it on every navigation, hence once per load. null hands the tab back to the
// browser's own zoom. Some pages (PDFs, error pages) refuse: they stay as they are.
async function applyZoom(tabId, zoom) {
  try {
    await chrome.tabs.setZoomSettings(tabId, { mode: "automatic", scope: "per-tab" });
    await chrome.tabs.setZoom(tabId, zoom ? zoom / 100 : 0);
  } catch {
    // Not zoomable.
  }
}

async function rememberScreen(entry) {
  if (entry.status === SCREEN_STATUS.LOADING) return;
  const patch = { status: entry.status, finalUrl: entry.finalUrl, error: entry.loadError ?? null };
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
    zoom: screen.zoom ?? null,
    loadError: null,
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

async function windowState(windowId) {
  return (await chrome.windows.get(windowId).catch(() => null))?.state ?? null;
}

async function rebalance(runtime, list) {
  const tabsBefore = new Set(poolTabIds(runtime));
  // Only a full screen this rebalance takes away (by opening a tab) is given back.
  const wasFullscreen = runtime.fullscreen && !runtime.paused && await windowState(runtime.windowId) === "fullscreen";
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
  const openedTabs = poolTabIds(runtime).some((tabId) => !tabsBefore.has(tabId));
  if (wasFullscreen && openedTabs) await returnToFullscreen(runtime, { openedTabs });
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
}

async function showEntry(runtime, list, entry) {
  const loadedBefore = new Set(runtime.pool.map((item) => item.screenId));
  await activateEntry(runtime, list, entry);
  await rebalance(runtime, list);
  // rebalance replaces an entry whose tab died in the meantime.
  const shown = entryForScreen(runtime, entry.screenId);
  if (shown && shown.tabId !== runtime.currentTabId) await activateEntry(runtime, list, shown);
  await schedule(runtime, list);
  await rememberScreen(shown ?? entry);
  if (list.reloadBeforeShow) await reloadUpcoming(runtime, list, loadedBefore);
}

// In short lists every screen stays loaded: refresh the next one while it is hidden.
// A screen that just entered the pool was loaded a moment ago and is left alone.
async function reloadUpcoming(runtime, list, loadedBefore) {
  if (runtime.paused || list.screens.length < 2) return;
  const next = entryForScreen(runtime, list.screens[modulo(runtime.currentIndex + 1, list.screens.length)].id);
  if (!next || next.tabId === runtime.currentTabId || !loadedBefore.has(next.screenId)) return;
  if (next.status === SCREEN_STATUS.LOADING) return;
  next.status = SCREEN_STATUS.LOADING;
  await persist(runtime);
  await chrome.tabs.reload(next.tabId).catch(() => {});
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
  await forgetSession({ keepForRestart: keepRecovery });
  await syncActionState(null);
  syncKeepAwake(null);
  if (closeTabs && runtime) await releaseWindow(runtime.windowId, poolTabIds(runtime), runtime);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Edge ignores a full-screen request made at creation or while a new window is still
// opening, so it is asked for again until the window reports it (about 1.5 s at most).
async function enterFullscreen(windowId) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await chrome.windows.update(windowId, { state: "fullscreen" }).catch(() => {});
    const window = await chrome.windows.get(windowId).catch(() => null);
    if (!window || window.state === "fullscreen") return;
    await sleep(150);
  }
}

// Opening a tab takes its window out of full screen; switching, loading, zooming or
// closing tabs does not. A full-screen session goes back once its tabs exist. While
// paused it stays out, so the toolbar and the tabs are there to investigate with.
async function returnToFullscreen(runtime, { openedTabs = false } = {}) {
  if (!runtime.fullscreen || runtime.paused) return;
  // The browser leaves full screen a moment after the tab opens: let that happen first.
  for (let waited = 0; openedTabs && waited < 600; waited += 50) {
    if (await windowState(runtime.windowId) !== "fullscreen") break;
    await sleep(50);
  }
  await enterFullscreen(runtime.windowId);
}

// A full-screen list opens a window of its own on its first screen; a session that
// resumes in tabs it already had keeps its window. Full screen comes once the tabs exist.
async function prepareWindow(runtime, list, adopt) {
  if (!list.fullscreen || adopt.length) return adopt;
  const screen = list.screens[runtime.currentIndex];
  const window = await chrome.windows.create({ url: screen.url, focused: true });
  runtime.windowId = window.id;
  runtime.ownWindow = true;
  return [{ tabId: window.tabs[0].id, screenId: screen.id }];
}

// Tabs left by an earlier session (before an update or a restart) join the pool as they are.
async function adoptTabs(runtime, list, adopt) {
  for (const { tabId, screenId } of adopt) {
    const index = list.screens.findIndex((screen) => screen.id === screenId);
    const tab = await safeGetTab(tabId);
    if (index < 0 || tab?.windowId !== runtime.windowId || entryForScreen(runtime, screenId)) continue;
    const entry = newEntry(tabId, list.screens[index], index);
    applyTabState(entry, tab);
    runtime.pool.push(entry);
    await chrome.tabs.update(tabId, { autoDiscardable: false });
    // A restored tab may not have loaded its page yet.
    if (tab.discarded || tab.status === "unloaded") await chrome.tabs.reload(tabId);
    else if (entry.zoom) await applyZoom(tabId, entry.zoom);
  }
}

// adopt: [{ tabId, screenId }] tabs to take over instead of opening new ones.
export function startList(listId, windowId, startIndex = 0, { adopt = [], ownWindow = false, paused = false } = {}) {
  return exclusive(async () => {
    // Validate first: a list that cannot start must not end the one that is running.
    const list = await loadRotationList(listId);
    const previous = await getRuntime();
    await clearScheduler();

    const runtime = {
      running: true,
      paused,
      listId,
      windowId,
      ownWindow,
      fullscreen: list.fullscreen,
      keepAwake: list.keepAwake,
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
      await adoptTabs(runtime, list, await prepareWindow(runtime, list, adopt));
      await rebalance(runtime, list);
      const first = entryForScreen(runtime, list.screens[runtime.currentIndex].id);
      if (!first) throw new Error(t("errorStartFailed"));
      await activateEntry(runtime, list, first);
      await schedule(runtime, list);
      await returnToFullscreen(runtime);
    } catch (error) {
      await teardown(runtime);
      if (previous) await releaseWindow(previous.windowId, poolTabIds(previous), previous);
      throw error;
    }

    // The previous session's tabs go last so the window is never left empty.
    if (previous) await releaseWindow(previous.windowId, poolTabIds(previous), previous);
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
    // Out of full screen, the toolbar and the tabs are there to investigate with.
    if (runtime.fullscreen) await chrome.windows.update(runtime.windowId, { state: "maximized" }).catch(() => {});
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
    await returnToFullscreen(runtime);
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
    const loaded = changeInfo.status === "complete";
    if (loaded && entry.zoom) await applyZoom(tabId, entry.zoom);
    const fresh = tab ?? await safeGetTab(tabId);
    if (fresh && applyTabState(entry, fresh)) {
      await persist(runtime);
      await rememberScreen(entry);
    }
    // Keep the session record on the address the tab ended up at, redirects included.
    if (loaded || changeInfo.url) await rememberSession(runtime);
  });
}

// A new navigation in a managed tab clears the failure of the previous one.
export function handleNavigationStarted({ tabId, frameId }) {
  if (frameId !== 0) return Promise.resolve();
  return exclusive(async () => {
    const runtime = await getRuntime();
    const entry = runtime && entryForTab(runtime, tabId);
    if (!entry?.loadError) return;
    entry.loadError = null;
    await persist(runtime);
  });
}

// DNS failures, refused connections and the like: the tab still ends "complete",
// on the browser's error page, so this is the only reliable signal.
export function handleNavigationError({ tabId, frameId, error }) {
  if (frameId !== 0 || error === NAVIGATION_ABORTED) return Promise.resolve();
  return exclusive(async () => {
    const runtime = await getRuntime();
    const entry = runtime && entryForTab(runtime, tabId);
    if (!entry) return;
    entry.loadError = error;
    entry.status = SCREEN_STATUS.ERROR;
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
      // Usually the browser quitting. An auto-resume list keeps its record so it
      // comes back on the next start; only an explicit stop clears it.
      const list = (await getLists()).find((item) => item.id === runtime.listId);
      await teardown(runtime, { keepRecovery: Boolean(list?.autoResume), closeTabs: false });
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
    runtime.keepAwake = list.keepAwake;

    const indexById = new Map(list.screens.map((screen, index) => [screen.id, index]));
    const current = entryForTab(runtime, runtime.currentTabId);
    let currentIsStale = !current;

    for (const entry of [...runtime.pool]) {
      const index = indexById.get(entry.screenId);
      if (index !== undefined && list.screens[index].url === entry.url) {
        entry.index = index;
        const zoom = list.screens[index].zoom ?? null;
        if ((entry.zoom ?? null) !== zoom) {
          entry.zoom = zoom;
          await applyZoom(entry.tabId, zoom);
        }
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
    syncKeepAwake(runtime);
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

function screenIndex(list, screenId) {
  return Math.max(0, rotationScreens(list).findIndex((screen) => screen.id === screenId));
}

// After an update the browser is still running: the window and the tabs the
// session owned are still there, so the rotation carries on in them.
export async function resumeAfterUpdate() {
  if (await getRuntime()) return;
  const recovery = await getRecovery();
  if (recovery?.version !== RECOVERY_VERSION || !recovery.live) return;

  const list = (await getLists()).find((item) => item.id === recovery.listId);
  const window = await chrome.windows.get(recovery.windowId).catch(() => null);
  // The window is gone: the update was applied while the browser restarted.
  if (!window) return resumeAtBrowserStart();
  if (!list || window.type !== "normal") return;

  const adopt = [];
  for (const saved of recovery.tabs ?? []) {
    const tab = await safeGetTab(saved.tabId);
    // Tab ids are not reused while the browser runs; the origin only guards against a
    // tab that moved on to another site. A tab recorded while still opening had no address.
    const sameSite = !saved.url || sameOrigin(tab?.url || tab?.pendingUrl, saved.url);
    if (tab?.windowId === recovery.windowId && sameSite) adopt.push({ tabId: tab.id, screenId: saved.screenId });
  }
  if (!adopt.length) return;

  await startList(list.id, recovery.windowId, screenIndex(list, recovery.screenId), {
    adopt,
    ownWindow: Boolean(recovery.ownWindow),
    paused: Boolean(recovery.paused)
  });
}

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

// A restored session brings the rotation's tabs back at the positions they had.
// Only a tab at the same position with the same address is taken over.
function restoredTabs(recovery, tabs) {
  const byWindow = new Map();
  for (const tab of tabs) byWindow.set(tab.windowId, [...(byWindow.get(tab.windowId) ?? []), tab]);

  let best = { windowId: null, adopt: [] };
  for (const [windowId, windowTabs] of byWindow) {
    const adopt = (recovery.tabs ?? []).flatMap((saved) => {
      const tab = windowTabs.find((item) => item.index === saved.index && item.url === saved.url);
      return tab ? [{ tabId: tab.id, screenId: saved.screenId }] : [];
    });
    if (adopt.length > best.adopt.length) best = { windowId, adopt };
  }
  return best;
}

// The browser may still be restoring tabs when the extension starts.
async function waitForRestoredTabs(recovery) {
  const wanted = recovery.tabs?.length ?? 0;
  const deadline = Date.now() + RESTORE_SETTLE_MS;
  for (;;) {
    const found = restoredTabs(recovery, await chrome.tabs.query({ windowType: "normal" }));
    if (found.adopt.length >= wanted || Date.now() >= deadline) return found;
    await new Promise((resolve) => setTimeout(resolve, RESTORE_POLL_MS));
  }
}

async function resumeList(firstWindowOnly) {
  if (await getRuntime()) return;
  const recovery = await getRecovery();
  if (!recovery) return;

  const list = (await getLists()).find((item) => item.id === recovery.listId);
  if (!list?.autoResume) {
    await saveRecovery(null);
    return;
  }

  const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
  // No window yet (Edge starting in the background): the first one to open will call again.
  if (!windows.length || (firstWindowOnly && windows.length > 1)) return;

  const restored = await waitForRestoredTabs(recovery);
  const focused = await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => windows[0]);
  await startList(list.id, restored.windowId ?? focused.id, screenIndex(list, recovery.screenId), {
    adopt: restored.adopt,
    ownWindow: restored.adopt.length > 0 && Boolean(recovery.ownWindow)
  });
}

let resuming = null;

// Runs when the browser starts, and when the first window opens: Edge keeps running in
// the background after its last window closes, so reopening it is not a browser start.
export function resumeAtBrowserStart({ firstWindowOnly = false } = {}) {
  resuming ??= resumeList(firstWindowOnly).finally(() => {
    resuming = null;
  });
  return resuming;
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
    const status = entry ? entry.status : lastProblem;
    const code = entry ? entry.loadError : known.error;
    return {
      id: screen.id,
      url: screen.url,
      title: screenTitle(screen, index, observedTitle),
      duration: effectiveDuration(list, screen),
      status,
      error: status === SCREEN_STATUS.ERROR && code ? code.replace(/^net::/, "") : null
    };
  });
  return state;
}
