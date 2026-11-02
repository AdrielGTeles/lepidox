// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

import { LOAD_TIMEOUT_MS } from "../core/constants.js";

export async function safeGetTab(tabId) {
  if (!Number.isInteger(tabId)) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

export async function waitForTabReady(tabId, timeoutMs = LOAD_TIMEOUT_MS) {
  const current = await safeGetTab(tabId);
  if (!current) return { ready: false, tab: null, reason: "closed" };
  if (current.status === "complete") return { ready: true, tab: current, reason: "complete" };

  return new Promise((resolve) => {
    let settled = false;
    const finish = async (ready, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      resolve({ ready, tab: await safeGetTab(tabId), reason });
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish(true, "complete");
    };
    const onRemoved = (removedTabId) => {
      if (removedTabId === tabId) finish(false, "closed");
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    const timeoutId = setTimeout(() => finish(false, "timeout"), timeoutMs);
  });
}

// Ends a session's hold on its window. A window Lepidox opened for the rotation is
// closed when it holds nothing else and another window stays open; otherwise it
// leaves full screen and loses only the rotation's tabs.
export async function releaseWindow(windowId, tabIds, { ownWindow = false, fullscreen = false } = {}) {
  if (ownWindow) {
    const [tabs, windows] = await Promise.all([
      chrome.tabs.query({ windowId }).catch(() => []),
      chrome.windows.getAll({ windowTypes: ["normal"] })
    ]);
    const onlyRotation = tabs.length > 0 && tabs.every((tab) => tabIds.includes(tab.id));
    if (onlyRotation && windows.some((window) => window.id !== windowId)) {
      await chrome.windows.remove(windowId).catch(() => {});
      return;
    }
  }
  if (fullscreen) await chrome.windows.update(windowId, { state: "maximized" }).catch(() => {});
  await removeTabsKeepingWindow(windowId, tabIds);
}

// Removing the last tab of a window closes the window (and possibly the browser).
export async function removeTabsKeepingWindow(windowId, tabIds) {
  if (!tabIds.length) return;
  try {
    const remaining = await chrome.tabs.query({ windowId });
    if (remaining.length && remaining.every((tab) => tabIds.includes(tab.id))) {
      await chrome.tabs.create({ windowId });
    }
  } catch {
    // The window is already gone.
  }
  try {
    await chrome.tabs.remove(tabIds);
  } catch {
    // One or more tabs may already be closed.
  }
}
