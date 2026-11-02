// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { installChrome } from "./chrome-mock.mjs";

const chrome = installChrome();
const { ALARM_NAME, STORAGE_KEYS } = await import("../src/core/constants.js");
const storage = await import("../src/core/storage.js");
const { exclusive } = await import("../src/background/lock.js");
const manager = await import("../src/background/rotation-manager.js");
const { preflightList } = await import("../src/background/preflight.js");
// Registers the real listeners, so tab and storage events flow as in the browser.
await import("../src/background/service-worker.js");

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// Lets queued events, page loads and locked sections run to completion.
async function settle() {
  for (let round = 0; round < 8; round += 1) {
    await tick();
    await exclusive(async () => {});
  }
}

function makeList(count, overrides = {}) {
  return {
    id: "wall",
    name: "Wall",
    defaultDuration: 10,
    investigationPoolSize: 5,
    autoResume: false,
    fullscreen: false,
    keepAwake: false,
    reloadBeforeShow: false,
    screens: Array.from({ length: count }, (_, index) => ({
      id: `s${index}`,
      name: "",
      url: `https://dash.test/d/${index}`,
      duration: null,
      zoom: null,
      enabled: true
    })),
    ...overrides
  };
}

async function saveLists(...lists) {
  await storage.saveLists(lists);
  await settle();
}

async function start(list, index = 0) {
  await saveLists(list);
  await manager.startList(list.id, 1, index);
  await settle();
}

const runtime = () => storage.getRuntime();
const poolScreens = async () => (await runtime()).pool.map((entry) => entry.screenId).sort();
const loadingTabs = () => [...chrome.test.tabs.values()].filter((tab) => tab.status === "loading");

beforeEach(async () => {
  chrome.test.tabs.clear();
  chrome.storage.local.data.clear();
  chrome.storage.session.data.clear();
  chrome.test.autoLoad = true;
  chrome.test.failures.clear();
  chrome.test.resetWindows();
  chrome.test.reloads.length = 0;
  chrome.test.zoom.clear();
  chrome.test.zoomFails = false;
  await chrome.tabs.create({ url: "https://user.test/inbox" });
  await settle();
});

afterEach(async () => {
  chrome.test.autoLoad = true;
  await manager.stopRotation();
  await settle();
});

test("starting a list shows the first screen and preloads its neighbours", async () => {
  await start(makeList(6));

  const state = await runtime();
  assert.equal(state.currentIndex, 0);
  assert.deepEqual(await poolScreens(), ["s0", "s1", "s5"]);
  assert.equal(chrome.test.activeTab().url, "https://dash.test/d/0");
  assert.equal(state.rotationMs, 10_000);
  assert.ok(state.nextRotationAt > Date.now());
  assert.ok(chrome.test.alarms.has(ALARM_NAME));
  assert.equal(chrome.test.icon, "/assets/icons/lepidox-active-16.png");
  // The user's own tab is left alone.
  assert.ok([...chrome.test.tabs.values()].some((tab) => tab.url === "https://user.test/inbox"));
});

test("next and previous move the window of loaded screens", async () => {
  await start(makeList(6));

  await manager.nextScreen();
  await settle();
  assert.equal((await runtime()).currentIndex, 1);
  assert.deepEqual(await poolScreens(), ["s0", "s1", "s2"]);
  assert.equal(chrome.test.tabs.size, 4);

  await manager.previousScreen();
  await manager.previousScreen();
  await settle();
  assert.equal((await runtime()).currentIndex, 5);
  assert.equal(chrome.test.activeTab().url, "https://dash.test/d/5");
});

test("the alarm rotates to the next screen once the deadline passes", async () => {
  await start(makeList(4));

  const early = await runtime();
  chrome.alarms.onAlarm.emit({ name: ALARM_NAME });
  await settle();
  assert.equal((await runtime()).currentIndex, 0, "an early alarm must not rotate");

  await storage.saveRuntime({ ...early, nextRotationAt: Date.now() - 1 });
  chrome.alarms.onAlarm.emit({ name: ALARM_NAME });
  await settle();
  assert.equal((await runtime()).currentIndex, 1);
});

test("a per-screen duration overrides the list duration", async () => {
  const list = makeList(3);
  list.screens[0].duration = 45;
  await start(list);
  assert.equal((await runtime()).rotationMs, 45_000);
});

test("pausing keeps more screens loaded and resuming trims them", async () => {
  await start(makeList(9));

  await manager.pauseRotation();
  await settle();
  let state = await runtime();
  assert.equal(state.paused, true);
  assert.equal(state.nextRotationAt, null);
  assert.equal(state.pool.length, 5);
  assert.equal(chrome.test.alarms.has(ALARM_NAME), false);
  assert.equal(chrome.test.icon, "/assets/icons/lepidox-paused-16.png");

  await manager.resumeRotation();
  await settle();
  state = await runtime();
  assert.equal(state.paused, false);
  assert.equal(state.pool.length, 3);
  assert.ok(state.nextRotationAt > Date.now());
});

test("a pause requested while a screen is loading is not lost", async () => {
  await start(makeList(9));
  chrome.test.autoLoad = false;

  const jump = manager.jumpToScreen(4);
  await settle();
  const pending = (await runtime()).pendingJump;
  assert.ok(pending, "the far screen is still loading");

  await manager.pauseRotation();
  await settle();
  chrome.test.finishLoad(pending.tabId);
  await jump;
  await settle();

  const state = await runtime();
  assert.equal(state.currentIndex, 4);
  assert.equal(state.paused, true);
  assert.equal(state.pendingJump, null);
  assert.equal(state.nextRotationAt, null);
});

test("pressing next while a screen loads skips ahead instead of repeating", async () => {
  await start(makeList(9));
  chrome.test.autoLoad = false;

  await manager.nextScreen(); // s1 was preloaded: shown at once, s2 starts loading
  await settle();
  const second = manager.nextScreen(); // waits for s2
  await settle();
  const third = manager.nextScreen(); // counts from s2, so it targets s3
  await settle();

  loadingTabs().forEach((tab) => chrome.test.finishLoad(tab.id));
  await Promise.all([second, third]);
  await settle();
  assert.equal((await runtime()).currentIndex, 3);
});

test("stopping during a load leaves nothing behind", async () => {
  await start(makeList(9));
  chrome.test.autoLoad = false;

  const jump = manager.jumpToScreen(4);
  await settle();
  await manager.stopRotation();
  loadingTabs().forEach((tab) => chrome.test.finishLoad(tab.id));
  await jump;
  await settle();

  assert.equal(await runtime(), null);
  assert.equal(chrome.test.tabs.size, 1);
  assert.equal(chrome.test.alarms.has(ALARM_NAME), false);
});

test("reordering the running list keeps each tab on its screen", async () => {
  const list = makeList(6);
  await start(list);
  const before = (await runtime()).currentTabId;

  await saveLists({ ...list, screens: [...list.screens].reverse() });

  const state = await runtime();
  assert.equal(state.currentTabId, before);
  assert.equal(state.currentIndex, 5);
  assert.equal(chrome.test.activeTab().url, "https://dash.test/d/0");
  for (const entry of state.pool) {
    assert.equal(chrome.test.tabs.get(entry.tabId).url, entry.url);
    assert.equal(state.pool.filter((item) => item.screenId === entry.screenId).length, 1);
  }
});

test("removing the screen on display moves to the one that takes its place", async () => {
  const list = makeList(6);
  await start(list);

  await saveLists({ ...list, screens: list.screens.slice(1) });

  const state = await runtime();
  assert.equal(state.currentIndex, 0);
  assert.equal(chrome.test.activeTab().url, "https://dash.test/d/1");
  assert.deepEqual(await poolScreens(), ["s1", "s2", "s5"]);
  assert.equal(chrome.test.tabs.size, 4);
});

test("changing the address of the screen on display reloads it in place", async () => {
  const list = makeList(6);
  await start(list);
  const before = (await runtime()).currentTabId;

  const screens = list.screens.map((screen) => ({ ...screen }));
  screens[0].url = "https://dash.test/d/renamed";
  await saveLists({ ...list, screens });

  const state = await runtime();
  assert.equal(state.currentTabId, before);
  assert.equal(chrome.test.activeTab().url, "https://dash.test/d/renamed");
  assert.equal(chrome.test.tabs.size, 4);
});

test("deleting the running list stops the rotation", async () => {
  await start(makeList(4));
  await saveLists();

  assert.equal(await runtime(), null);
  assert.equal(chrome.test.tabs.size, 1);
  assert.equal(chrome.test.icon, "/assets/icons/lepidox-inactive-16.png");
});

test("a managed tab closed by accident is reopened", async () => {
  await start(makeList(6));
  const closed = (await runtime()).currentTabId;

  chrome.test.closeTab(closed);
  await settle();

  const state = await runtime();
  assert.notEqual(state.currentTabId, closed);
  assert.equal(state.pool.length, 3);
  assert.equal(chrome.test.activeTab().url, "https://dash.test/d/0");
});

test("closing the window ends the session but keeps auto-resume", async () => {
  await start(makeList(4, { autoResume: true }));
  const { currentTabId } = await runtime();

  chrome.test.closeTab(currentTabId, { isWindowClosing: true });
  await settle();

  assert.equal(await runtime(), null);
  const recovery = await storage.getRecovery();
  assert.equal(recovery.listId, "wall");
  assert.equal(recovery.screenId, "s0");
  assert.equal(recovery.live, false);
});

test("closing the window of a list without auto-resume forgets it", async () => {
  await start(makeList(4));
  chrome.test.closeTab((await runtime()).currentTabId, { isWindowClosing: true });
  await settle();
  assert.equal(await storage.getRecovery(), null);
});

test("an explicit stop clears auto-resume and never empties the window", async () => {
  await start(makeList(4, { autoResume: true }));
  for (const tab of chrome.test.tabs.values()) {
    if (tab.url.startsWith("https://user.test")) chrome.test.closeTab(tab.id);
  }

  await manager.stopRotation();
  await settle();

  assert.equal(await storage.getRecovery(), null);
  assert.equal(chrome.test.tabs.size, 1, "a blank tab keeps the window open");
});

test("starting another list replaces the running one", async () => {
  const other = { ...makeList(3), id: "other", name: "Other" };
  other.screens.forEach((screen) => { screen.id = `o-${screen.id}`; screen.url += "?other"; });
  await saveLists(makeList(6), other);
  await manager.startList("wall", 1);
  await settle();

  await manager.startList("other", 1);
  await settle();

  const state = await runtime();
  assert.equal(state.listId, "other");
  assert.equal(chrome.test.tabs.size, 4);
  assert.equal(chrome.test.activeTab().url, "https://dash.test/d/0?other");
});

test("a list that cannot start does not end the running one", async () => {
  const empty = { ...makeList(1), id: "empty" };
  empty.screens[0].enabled = false;
  await saveLists(makeList(4), empty);
  await manager.startList("wall", 1);
  await settle();

  await assert.rejects(manager.startList("empty", 1), /no enabled screen/);
  assert.equal((await runtime()).listId, "wall");
});

test("while paused, clicking a managed tab moves the session to that screen", async () => {
  await start(makeList(9));
  await manager.pauseRotation();
  await settle();

  const target = (await runtime()).pool.find((entry) => entry.screenId === "s2");
  await chrome.tabs.update(target.tabId, { active: true });
  await settle();

  const state = await runtime();
  assert.equal(state.currentIndex, 2);
  assert.equal(state.currentTabId, target.tabId);
  assert.deepEqual(await poolScreens(), ["s0", "s1", "s2", "s3", "s4"]);
});

test("while rotating, clicking a managed tab does not hijack the rotation", async () => {
  await start(makeList(9));
  const neighbour = (await runtime()).pool.find((entry) => entry.screenId === "s1");

  await chrome.tabs.update(neighbour.tabId, { active: true });
  await settle();

  assert.equal((await runtime()).currentIndex, 0);
});

test("a restarted service worker catches up on a missed deadline", async () => {
  await start(makeList(4));
  await storage.saveRuntime({ ...(await runtime()), nextRotationAt: Date.now() - 5_000 });

  await manager.recoverScheduler();
  await settle();
  await tick();
  await settle();

  assert.equal((await runtime()).currentIndex, 1);
});

test("an auto-resume list comes back at the screen it was on when the browser starts", async () => {
  await start(makeList(5, { autoResume: true }), 0);
  await manager.nextScreen();
  await manager.nextScreen();
  await settle();
  // The browser quits: the session storage is gone, the recovery record stays.
  chrome.test.closeTab((await runtime()).currentTabId, { isWindowClosing: true });
  await settle();
  chrome.test.tabs.clear();

  chrome.runtime.onStartup.emit();
  // Nothing was restored, so this waits out the time the browser gets to restore tabs.
  await manager.resumeAtBrowserStart();
  await settle();

  const state = await runtime();
  assert.equal(state.listId, "wall");
  assert.equal(state.currentIndex, 2);
  assert.equal(chrome.test.activeTab().url, "https://dash.test/d/2");
});

test("a list without auto-resume stays stopped when the browser starts", async () => {
  await start(makeList(5));
  chrome.test.closeTab((await runtime()).currentTabId, { isWindowClosing: true });
  await settle();

  chrome.runtime.onStartup.emit();
  await settle();

  assert.equal(await runtime(), null);
});

test("the public state names screens after their pages and flags sign-in redirects", async () => {
  const list = makeList(4);
  list.screens[2].name = "Payments";
  await saveLists(list);
  chrome.test.autoLoad = false;
  const starting = manager.startList("wall", 1);
  await settle();
  await starting;

  for (const entry of (await runtime()).pool) {
    if (entry.screenId === "s1") chrome.test.finishLoad(entry.tabId, { url: "https://dash.test/login?redirect=/d/1", title: "Sign in" });
    else chrome.test.finishLoad(entry.tabId, { title: `Board ${entry.screenId}` });
  }
  await settle();

  const state = await manager.getPublicState();
  assert.equal(state.listName, "Wall");
  assert.equal(state.screens[0].title, "Board s0");
  assert.equal(state.screens[0].status, "ready");
  assert.equal(state.screens[1].status, "auth");
  assert.equal(state.screens[1].title, "dash.test · 1", "a sign-in page title is not used as the name");
  assert.equal(state.screens[2].title, "Payments");
  assert.equal(state.screens[2].status, "cold");
  assert.equal(state.screens[3].duration, 10);

  const meta = (await chrome.storage.local.get(STORAGE_KEYS.SCREEN_META))[STORAGE_KEYS.SCREEN_META];
  assert.equal(meta.s0.title, "Board s0");
  assert.equal(meta.s1.status, "auth");
  assert.equal(meta.s1.title, undefined);
});

test("observed titles never rewrite the saved lists", async () => {
  const list = makeList(3);
  await start(list);
  const stored = (await chrome.storage.local.get(STORAGE_KEYS.LISTS))[STORAGE_KEYS.LISTS];
  assert.deepEqual(stored, [list]);
});

const publicScreen = async (index) => (await manager.getPublicState()).screens[index];

test("a screen that fails to load is flagged with the browser's error until it loads again", async () => {
  chrome.test.autoLoad = false;
  await start(makeList(4));
  const next = (await runtime()).pool.find((entry) => entry.screenId === "s1");

  chrome.test.failLoad(next.tabId, "net::ERR_NAME_NOT_RESOLVED");
  await settle();
  assert.equal((await publicScreen(1)).status, "error");
  assert.equal((await publicScreen(1)).error, "ERR_NAME_NOT_RESOLVED");
  assert.equal((await storage.getScreenMeta()).s1.error, "net::ERR_NAME_NOT_RESOLVED");

  await chrome.tabs.update(next.tabId, { url: "https://dash.test/d/1" });
  chrome.test.finishLoad(next.tabId);
  await settle();
  assert.equal((await publicScreen(1)).status, "ready");
  assert.equal((await publicScreen(1)).error, null);
  assert.equal((await storage.getScreenMeta()).s1.error ?? null, null);
});

test("a dashboard whose title talks about errors is not an error", async () => {
  chrome.test.autoLoad = false;
  await start(makeList(4));
  const next = (await runtime()).pool.find((entry) => entry.screenId === "s1");
  chrome.test.finishLoad(next.tabId, { title: "Server errors by region · ERR_RATE" });
  await settle();
  assert.equal((await publicScreen(1)).status, "ready");
  assert.equal((await publicScreen(1)).title, "Server errors by region · ERR_RATE");
});

test("aborted navigations and frame errors are not load failures", async () => {
  chrome.test.autoLoad = false;
  await start(makeList(4));
  const next = (await runtime()).pool.find((entry) => entry.screenId === "s1");

  chrome.webNavigation.onErrorOccurred.emit({ tabId: next.tabId, frameId: 3, url: "https://ads.test/", error: "net::ERR_BLOCKED_BY_CLIENT" });
  chrome.test.failLoad(next.tabId, "net::ERR_ABORTED");
  await settle();
  assert.equal((await publicScreen(1)).status, "ready");
});

test("jumping to a screen that fails to load shows it as an error", async () => {
  chrome.test.failures.set("https://dash.test/d/4", "net::ERR_CONNECTION_REFUSED");
  await start(makeList(9));
  await manager.jumpToScreen(4);
  await settle();
  assert.equal((await runtime()).currentIndex, 4);
  assert.equal((await publicScreen(4)).status, "error");
  assert.equal((await publicScreen(4)).error, "ERR_CONNECTION_REFUSED");
});

test("check access reports pages that fail to load", async () => {
  await saveLists(makeList(3));
  chrome.test.failures.set("https://dash.test/d/1", "net::ERR_CONNECTION_REFUSED");
  const results = await preflightList("wall", 1);
  assert.deepEqual(results.map((item) => item.status), ["ready", "error", "ready"]);
  assert.equal((await storage.getScreenMeta()).s1.error, "net::ERR_CONNECTION_REFUSED");
});

// What an extension update does: the worker restarts with an empty session storage.
const simulateUpdate = () => chrome.storage.session.data.clear();
const managedTabIds = async () => (await runtime()).pool.map((entry) => entry.tabId).sort();

test("an update resumes the rotation in the same tabs", async () => {
  await start(makeList(6));
  await manager.nextScreen();
  await settle();
  const tabIds = await managedTabIds();
  const tabCount = chrome.test.tabs.size;

  simulateUpdate();
  await manager.resumeAfterUpdate();
  await settle();

  const state = await runtime();
  assert.equal(state.currentIndex, 1);
  assert.equal(state.paused, false);
  assert.deepEqual(await managedTabIds(), tabIds);
  assert.equal(chrome.test.tabs.size, tabCount);
  assert.equal(chrome.test.activeTab().url, "https://dash.test/d/1");
  assert.ok(state.nextRotationAt > Date.now());
});

test("a paused rotation is still paused after an update", async () => {
  await start(makeList(9));
  await manager.pauseRotation();
  await settle();
  simulateUpdate();
  await manager.resumeAfterUpdate();
  await settle();
  assert.equal((await runtime()).paused, true);
  assert.equal((await runtime()).pool.length, 5);
});

test("an update after the rotation window was closed starts nothing", async () => {
  await start(makeList(4, { autoResume: true }));
  chrome.test.closeTab((await runtime()).currentTabId, { isWindowClosing: true });
  await settle();
  simulateUpdate();
  await manager.resumeAfterUpdate();
  await settle();
  assert.equal(await runtime(), null);
});

test("a 1.1.0 recovery record is not resumed on update", async () => {
  await saveLists(makeList(4, { autoResume: true }));
  await storage.saveRecovery({ listId: "wall", screenId: "s1", wasRunning: true, updatedAt: 1 });
  await manager.resumeAfterUpdate();
  await settle();
  assert.equal(await runtime(), null);
});

test("browser start adopts restored tabs at the same position and address", async () => {
  await saveLists(makeList(4, { autoResume: true }));
  // Window 1: the user's inbox, the user's own copy of screen 0, then the restored rotation tabs.
  const own = await chrome.tabs.create({ url: "https://dash.test/d/0", active: false });
  const restored = [];
  for (const index of [0, 1, 3]) restored.push(await chrome.tabs.create({ url: `https://dash.test/d/${index}`, active: false }));
  await settle();
  await storage.saveRecovery({
    version: 2, listId: "wall", screenId: "s0", windowId: 7, ownWindow: false, live: true, paused: false, updatedAt: 1,
    tabs: [
      { tabId: 9001, screenId: "s0", index: 2, url: "https://dash.test/d/0" },
      { tabId: 9002, screenId: "s1", index: 3, url: "https://dash.test/d/1" },
      { tabId: 9003, screenId: "s3", index: 4, url: "https://dash.test/d/3" }
    ]
  });
  const tabCount = chrome.test.tabs.size;

  await manager.resumeAtBrowserStart();
  await settle();

  assert.deepEqual(await managedTabIds(), restored.map((tab) => tab.id).sort());
  assert.equal(chrome.test.tabs.size, tabCount, "no tab was opened or closed");
  assert.ok(chrome.test.tabs.has(own.id), "the user's own tab is left alone");
  assert.equal((await runtime()).currentTabId, restored[0].id);
});

test("browser start forgets a list without auto-resume", async () => {
  await saveLists(makeList(4));
  await storage.saveRecovery({ version: 2, listId: "wall", screenId: "s0", windowId: 1, live: true, tabs: [], updatedAt: 1 });
  await manager.resumeAtBrowserStart();
  await settle();
  assert.equal(await runtime(), null);
  assert.equal(await storage.getRecovery(), null);
});

test("the first browser window resumes an auto-resume list, a second one does not", async () => {
  await saveLists(makeList(4, { autoResume: true }));
  await storage.saveRecovery({ version: 2, listId: "wall", screenId: "s2", windowId: 1, live: false, tabs: [], updatedAt: 1 });

  chrome.test.windows.set(2, { id: 2, type: "normal", state: "normal", focused: false });
  chrome.windows.onCreated.emit({ id: 2, type: "normal" });
  await manager.resumeAtBrowserStart({ firstWindowOnly: true });
  await settle();
  assert.equal(await runtime(), null, "another window was already open");

  chrome.test.windows.delete(2);
  chrome.windows.onCreated.emit({ id: 1, type: "normal" });
  await manager.resumeAtBrowserStart({ firstWindowOnly: true });
  await settle();
  assert.equal((await runtime()).currentIndex, 2);
});

const tabsInWindow = (windowId) => [...chrome.test.tabs.values()].filter((tab) => tab.windowId === windowId);

test("a full-screen list opens in a window of its own and closes it when stopped", async () => {
  await saveLists(makeList(4, { fullscreen: true }));
  await manager.startList("wall", 1);
  await settle();

  const { windowId, pool, ownWindow } = await runtime();
  assert.notEqual(windowId, 1);
  assert.equal(ownWindow, true);
  assert.equal(chrome.test.windows.get(windowId).state, "fullscreen");
  assert.equal(tabsInWindow(windowId).length, 3, "the window's first tab became a screen");
  assert.ok(pool.every((entry) => chrome.test.tabs.get(entry.tabId).windowId === windowId));
  assert.equal(chrome.test.activeTab(windowId).url, "https://dash.test/d/0");
  assert.deepEqual(tabsInWindow(1).map((tab) => tab.url), ["https://user.test/inbox"]);

  await manager.stopRotation();
  await settle();
  assert.equal(chrome.test.windows.has(windowId), false);
  assert.deepEqual(tabsInWindow(1).map((tab) => tab.url), ["https://user.test/inbox"]);
});

test("stopping a full-screen rotation in the only window leaves full screen and keeps the window", async () => {
  await saveLists(makeList(4, { fullscreen: true }));
  await manager.startList("wall", 1);
  await settle();
  const { windowId } = await runtime();
  await chrome.windows.remove(1);
  await settle();

  await manager.stopRotation();
  await settle();
  assert.equal(chrome.test.windows.get(windowId).state, "maximized");
  assert.equal(tabsInWindow(windowId).length, 1, "a blank tab keeps the window open");
});

test("closing the full-screen window ends the session and keeps auto-resume", async () => {
  await saveLists(makeList(4, { fullscreen: true, autoResume: true }));
  await manager.startList("wall", 1);
  await settle();
  const { windowId } = await runtime();
  await chrome.windows.remove(windowId);
  await settle();
  assert.equal(await runtime(), null);
  assert.equal((await storage.getRecovery()).live, false);
  assert.ok(chrome.test.windows.has(1));
});

test("keep awake holds the display on while the list runs, paused or not", async () => {
  await start(makeList(3, { keepAwake: true }));
  assert.equal(chrome.test.keepAwake, "display");
  await manager.pauseRotation();
  await settle();
  assert.equal(chrome.test.keepAwake, "display");
  await manager.stopRotation();
  await settle();
  assert.equal(chrome.test.keepAwake, null);
});

test("keep awake follows the option while running and is off by default", async () => {
  await start(makeList(3));
  assert.equal(chrome.test.keepAwake, null);
  await saveLists(makeList(3, { keepAwake: true }));
  assert.equal(chrome.test.keepAwake, "display");
});

test("reload before showing refreshes the next screen when it was already loaded", async () => {
  await start(makeList(3, { reloadBeforeShow: true }));
  const next = (await runtime()).pool.find((entry) => entry.screenId === "s2");
  await manager.nextScreen();
  await settle();
  assert.deepEqual(chrome.test.reloads, [next.tabId]);
});

test("reload before showing leaves fresh tabs, paused sessions and other lists alone", async () => {
  await start(makeList(5, { reloadBeforeShow: true }));
  await manager.nextScreen();
  await settle();
  assert.deepEqual(chrome.test.reloads, [], "the next screen was loaded just now");

  await manager.pauseRotation();
  await manager.jumpToScreen(3);
  await settle();
  assert.deepEqual(chrome.test.reloads, [], "nothing reloads while paused");

  await start(makeList(3));
  await manager.nextScreen();
  await settle();
  assert.deepEqual(chrome.test.reloads, [], "the option is off");
});

const tabOf = async (screenId) => (await runtime()).pool.find((entry) => entry.screenId === screenId)?.tabId;

function zoomedList(zoom) {
  const list = makeList(3);
  list.screens[1].zoom = zoom;
  return list;
}

test("a screen's zoom is applied each time its page loads, and only to that tab", async () => {
  await start(zoomedList(150));
  const tabId = await tabOf("s1");
  assert.equal(chrome.test.zoom.get(tabId), 1.5);
  assert.equal(chrome.test.zoom.has(await tabOf("s0")), false, "screens without zoom are left alone");

  chrome.test.zoom.clear();
  await chrome.tabs.reload(tabId);
  await settle();
  assert.equal(chrome.test.zoom.get(tabId), 1.5);
});

test("editing a running screen's zoom applies at once", async () => {
  await start(zoomedList(150));
  const tabId = await tabOf("s1");
  await saveLists(zoomedList(80));
  assert.equal(chrome.test.zoom.get(tabId), 0.8);
  await saveLists(zoomedList(null));
  assert.equal(chrome.test.zoom.get(tabId), 0, "back to the browser's zoom");
  assert.equal(await tabOf("s1"), tabId, "the page was not reloaded");
});

test("a page that refuses zoom does not stop the rotation", async () => {
  chrome.test.zoomFails = true;
  await start(zoomedList(150));
  await manager.nextScreen();
  await manager.nextScreen();
  await settle();
  assert.equal((await runtime()).currentIndex, 2);
});

test("an update applied while the browser restarts resumes an auto-resume list", async () => {
  await saveLists(makeList(4, { autoResume: true }));
  // The recorded window belonged to the previous browser session.
  await storage.saveRecovery({ version: 2, listId: "wall", screenId: "s1", windowId: 7, live: true, tabs: [], updatedAt: 1 });
  await manager.resumeAfterUpdate();
  await settle();
  assert.equal((await runtime()).currentIndex, 1);
});

test("a browser restart after a browser update resumes an auto-resume list", async () => {
  await saveLists(makeList(4, { autoResume: true }));
  await storage.saveRecovery({ version: 2, listId: "wall", screenId: "s2", windowId: 7, live: true, tabs: [], updatedAt: 1 });
  chrome.runtime.onInstalled.emit({ reason: "chrome_update" });
  await settle();
  await settle();
  assert.equal((await runtime()).currentIndex, 2);
});

test("pausing a full-screen rotation leaves full screen so its tabs can be clicked, resuming goes back", async () => {
  await saveLists(makeList(9, { fullscreen: true }));
  await manager.startList("wall", 1);
  await settle();
  const { windowId } = await runtime();

  await manager.pauseRotation();
  await settle();
  assert.equal(chrome.test.windows.get(windowId).state, "maximized");

  await manager.resumeRotation();
  await settle();
  assert.equal(chrome.test.windows.get(windowId).state, "fullscreen");
});

test("a full-screen rotation goes back to full screen after reopening a closed tab", async () => {
  await saveLists(makeList(6, { fullscreen: true }));
  await manager.startList("wall", 1);
  await settle();
  const { windowId, pool, currentTabId } = await runtime();

  chrome.test.closeTab(pool.find((entry) => entry.tabId !== currentTabId).tabId);
  await settle();
  assert.equal((await runtime()).pool.length, 3, "the closed screen was reopened");
  assert.equal(chrome.test.windows.get(windowId).state, "fullscreen");
});

test("pausing a short full-screen list also leaves full screen", async () => {
  await saveLists(makeList(3, { fullscreen: true }));
  await manager.startList("wall", 1);
  await settle();
  const { windowId } = await runtime();
  await manager.pauseRotation();
  await settle();
  assert.equal(chrome.test.windows.get(windowId).state, "maximized");
});

test("the session record follows where each tab ended up, redirects included", async () => {
  chrome.test.autoLoad = false;
  await start(makeList(4));
  const next = (await runtime()).pool.find((entry) => entry.screenId === "s1");
  chrome.test.finishLoad(next.tabId, { url: "https://dash.test/d/1?orgId=1" });
  await settle();
  const saved = (await storage.getRecovery()).tabs.find((item) => item.screenId === "s1");
  assert.equal(saved.url, "https://dash.test/d/1?orgId=1");
});

test("a full-screen rotation the user took out of full screen is not forced back", async () => {
  await saveLists(makeList(6, { fullscreen: true }));
  await manager.startList("wall", 1);
  await settle();
  const { windowId, pool, currentTabId } = await runtime();
  await chrome.windows.update(windowId, { state: "maximized" }); // F11

  chrome.test.closeTab(pool.find((entry) => entry.tabId !== currentTabId).tabId);
  await settle();
  assert.equal((await runtime()).pool.length, 3, "the closed screen was reopened");
  assert.equal(chrome.test.windows.get(windowId).state, "maximized");
});

test("an update right after the start still finds tabs recorded before they had an address", async () => {
  await start(makeList(4));
  const tabIds = await managedTabIds();
  const recovery = await storage.getRecovery();
  // Chromium reports no address for a tab still opening.
  await storage.saveRecovery({ ...recovery, tabs: recovery.tabs.map((item) => ({ ...item, url: "" })) });

  simulateUpdate();
  await manager.resumeAfterUpdate();
  await settle();
  assert.deepEqual(await managedTabIds(), tabIds);
});
