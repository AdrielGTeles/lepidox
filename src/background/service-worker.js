// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

import { MESSAGE, STORAGE_KEYS } from "../core/constants.js";
import { migrateStorage } from "../core/storage.js";
import { t } from "../shared/i18n.js";
import { preflightList } from "./preflight.js";
import {
  getPublicState,
  handleAlarm,
  handleListsChanged,
  handleTabActivated,
  handleTabRemoved,
  handleTabUpdated,
  jumpToScreen,
  nextScreen,
  pauseRotation,
  previousScreen,
  recoverBrowserSession,
  recoverScheduler,
  resumeRotation,
  startList,
  stopRotation,
  togglePause
} from "./rotation-manager.js";

chrome.runtime.onInstalled.addListener(() => {
  migrateStorage().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  recoverBrowserSession().catch(console.error);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  handleAlarm(alarm).catch(console.error);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  handleTabUpdated(tabId, changeInfo, tab).catch(console.error);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  handleTabActivated(tabId).catch(console.error);
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  handleTabRemoved(tabId, removeInfo).catch(console.error);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEYS.LISTS]) handleListsChanged().catch(console.error);
});

chrome.commands.onCommand.addListener((command) => {
  const actions = {
    "toggle-pause": togglePause,
    "next-screen": nextScreen,
    "previous-screen": previousScreen,
    "stop-rotation": stopRotation
  };
  actions[command]?.().catch(console.error);
});

const handlers = {
  [MESSAGE.GET_STATE]: () => {},
  [MESSAGE.START_LIST]: (message) => startList(message.listId, message.windowId, message.startIndex ?? 0),
  [MESSAGE.STOP]: () => stopRotation(),
  [MESSAGE.PAUSE]: () => pauseRotation(),
  [MESSAGE.RESUME]: () => resumeRotation(),
  [MESSAGE.NEXT]: () => nextScreen(),
  [MESSAGE.PREVIOUS]: () => previousScreen(),
  [MESSAGE.JUMP_TO]: (message) => jumpToScreen(message.index)
};

// Every command answers with the resulting session state, so callers render
// from the reply instead of asking again.
async function dispatch(message) {
  if (message?.type === MESSAGE.PREFLIGHT_LIST) return preflightList(message.listId, message.windowId);
  const handler = handlers[message?.type];
  if (!handler) throw new Error(t("errorUnknownMessage"));
  await handler(message);
  return getPublicState();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  dispatch(message)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

// Restores timers and the toolbar icon whenever the service worker is brought back to life.
recoverScheduler().catch(console.error);
