// SPDX-License-Identifier: MPL-2.0

import { MESSAGE } from "../core/constants.js";
import {
  getPublicState,
  handleAlarm,
  handleManagedTabClosed,
  handleTabActivated,
  handleTabUpdated,
  jumpToScreen,
  nextScreen,
  pauseRotation,
  preflightList,
  previousScreen,
  recoverBrowserSession,
  recoverScheduler,
  resumeRotation,
  startList,
  stopRotation,
  togglePause
} from "./rotation-manager.js";
import { syncActionState } from "./action-state.js";

chrome.runtime.onInstalled.addListener(() => {
  syncActionState(null).catch(console.error);
  console.info("Lepidox 1.0.0 installed.");
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

chrome.tabs.onRemoved.addListener((tabId) => {
  handleManagedTabClosed(tabId).catch(console.error);
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case MESSAGE.GET_STATE:
      case MESSAGE.REFRESH_STATE:
        return getPublicState();
      case MESSAGE.START_LIST:
        return startList(message.listId, message.windowId, message.startIndex ?? 0);
      case MESSAGE.STOP:
        return stopRotation();
      case MESSAGE.PAUSE:
        return pauseRotation();
      case MESSAGE.RESUME:
        return resumeRotation();
      case MESSAGE.NEXT:
        return nextScreen();
      case MESSAGE.PREVIOUS:
        return previousScreen();
      case MESSAGE.JUMP_TO:
        return jumpToScreen(message.index);
      case MESSAGE.PREFLIGHT_LIST:
        return preflightList(message.listId, message.windowId);
      default:
        throw new Error("Mensagem desconhecida.");
    }
  })()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

// Restores sub-30s timers whenever the service worker is brought back to life.
recoverScheduler().catch(console.error);
