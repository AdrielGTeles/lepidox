// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

import { NAVIGATION_ABORTED, PREFLIGHT_TIMEOUT_MS, SCREEN_STATUS } from "../core/constants.js";
import { patchScreenMeta } from "../core/storage.js";
import { detectPageState } from "../shared/naming.js";
import { loadRotationList } from "./rotation-manager.js";
import { safeGetTab, waitForTabReady } from "./tabs.js";

// Loads every screen of a list once in a single background tab to find the ones
// that need a sign-in or fail to load, without starting a rotation.
export async function preflightList(listId, windowId) {
  const list = await loadRotationList(listId);
  const results = [];
  const tab = await chrome.tabs.create({ windowId, url: "about:blank", active: false });
  let failure = null;
  const onError = (details) => {
    if (details.tabId === tab.id && details.frameId === 0 && details.error !== NAVIGATION_ABORTED) failure = details.error;
  };
  chrome.webNavigation.onErrorOccurred.addListener(onError);

  try {
    for (const screen of list.screens) {
      failure = null;
      await chrome.tabs.update(tab.id, { url: screen.url });
      const loaded = await waitForTabReady(tab.id, PREFLIGHT_TIMEOUT_MS);
      if (loaded.reason === "closed") break;

      const fresh = loaded.tab ?? await safeGetTab(tab.id);
      const finalUrl = fresh?.url || screen.url;
      const status = loaded.reason === "timeout" || failure
        ? SCREEN_STATUS.ERROR
        : detectPageState(finalUrl, screen.url);

      const patch = { status, finalUrl, error: failure };
      if (status === SCREEN_STATUS.READY && fresh?.title) patch.title = fresh.title;
      await patchScreenMeta({ [screen.id]: patch });
      results.push({ screenId: screen.id, status });
    }
  } finally {
    chrome.webNavigation.onErrorOccurred.removeListener(onError);
    try {
      await chrome.tabs.remove(tab.id);
    } catch {
      // Already closed.
    }
  }
  return results;
}
