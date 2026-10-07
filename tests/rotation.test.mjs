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
    screens: Array.from({ length: count }, (_, index) => ({
      id: `s${index}`,
      name: "",
      url: `https://dash.test/d/${index}`,
      duration: null,
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
  await settle();
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
