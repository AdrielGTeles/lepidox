// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

// A small in-memory stand-in for the extension APIs Lepidox uses, enough to run
// the service worker under `node --test`.

import { readFileSync } from "node:fs";

const messages = JSON.parse(readFileSync(new URL("../_locales/en/messages.json", import.meta.url), "utf8"));

function event() {
  const listeners = new Set();
  return {
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    emit: (...args) => [...listeners].forEach((listener) => listener(...args))
  };
}

function storageArea(name, onChanged) {
  const data = new Map();
  const read = (key) => (data.has(key) ? structuredClone(data.get(key)) : undefined);
  return {
    data,
    async get(keys) {
      const wanted = keys === undefined || keys === null ? [...data.keys()] : [keys].flat();
      return Object.fromEntries(wanted.filter((key) => data.has(key)).map((key) => [key, read(key)]));
    },
    async set(items) {
      const changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: read(key), newValue: structuredClone(value) };
        data.set(key, structuredClone(value));
      }
      onChanged.emit(changes, name);
    },
    async remove(keys) {
      const changes = {};
      for (const key of [keys].flat()) {
        if (!data.has(key)) continue;
        changes[key] = { oldValue: read(key) };
        data.delete(key);
      }
      if (Object.keys(changes).length) onChanged.emit(changes, name);
    }
  };
}

export function installChrome() {
  const tabs = new Map();
  const alarms = new Map();
  const storageChanged = event();
  let nextTabId = 100;
  let nextWindowId = 50;

  const windows = new Map();

  const test = {
    tabs,
    alarms,
    windows,
    reloads: [],
    keepAwake: null,
    // tabId → zoom factor last set; zoomFails makes the browser refuse.
    zoom: new Map(),
    zoomFails: false,
    resetWindows() {
      windows.clear();
      windows.set(1, { id: 1, type: "normal", state: "normal", focused: true });
    },
    // When false, a page stays "loading" until finishLoad() is called.
    autoLoad: true,
    icon: null,
    finishLoad(tabId, { url, title } = {}) {
      const tab = tabs.get(tabId);
      if (!tab) return;
      tab.status = "complete";
      if (url) tab.url = url;
      tab.title = title ?? `Title of ${tab.url}`;
      chrome.tabs.onUpdated.emit(tabId, { status: "complete" }, { ...tab });
    },
    // The browser reports the failure, then shows its error page with the host as title.
    failLoad(tabId, error) {
      const tab = tabs.get(tabId);
      if (!tab) return;
      chrome.webNavigation.onErrorOccurred.emit({ tabId, frameId: 0, url: tab.url, error });
      test.finishLoad(tabId, { title: new URL(tab.url).hostname });
    },
    // url → net error: with autoLoad, loads of these addresses fail.
    failures: new Map(),
    closeTab(tabId, removeInfo = {}) {
      const tab = tabs.get(tabId);
      if (!tab) return;
      tabs.delete(tabId);
      chrome.tabs.onRemoved.emit(tabId, { windowId: tab.windowId, isWindowClosing: false, ...removeInfo });
    },
    activeTab: (windowId = 1) => [...tabs.values()].find((tab) => tab.windowId === windowId && tab.active) ?? null
  };

  // As in the browser, a new navigation cancels the one in flight: its load never completes.
  const navigations = new Map();

  function startLoad(tab) {
    const navigation = (navigations.get(tab.id) ?? 0) + 1;
    navigations.set(tab.id, navigation);
    tab.status = "loading";
    chrome.webNavigation.onBeforeNavigate.emit({ tabId: tab.id, frameId: 0, url: tab.url });
    chrome.tabs.onUpdated.emit(tab.id, { status: "loading", url: tab.url }, { ...tab });
    if (!test.autoLoad) return;
    const failure = test.failures.get(tab.url);
    setTimeout(() => {
      if (navigations.get(tab.id) !== navigation) return;
      if (failure) test.failLoad(tab.id, failure);
      else test.finishLoad(tab.id);
    }, 0);
  }

  // Tabs keep their creation order within a window, as if none was ever dragged.
  function withIndex(tab) {
    const index = [...tabs.values()].filter((other) => other.windowId === tab.windowId).indexOf(tab);
    return { ...tab, index };
  }

  function activate(tab) {
    for (const other of tabs.values()) if (other.windowId === tab.windowId) other.active = false;
    tab.active = true;
    chrome.tabs.onActivated.emit({ tabId: tab.id, windowId: tab.windowId });
  }

  const chrome = {
    test,
    runtime: {
      onInstalled: event(),
      onStartup: event(),
      onMessage: event(),
      getManifest: () => ({ version: "0.0.0" })
    },
    i18n: {
      getUILanguage: () => "en",
      getMessage(key, substitutions = []) {
        const message = messages[key]?.message ?? "";
        return message.replace(/\$(\d)/g, (_match, index) => substitutions[Number(index) - 1] ?? "");
      }
    },
    storage: {
      onChanged: storageChanged,
      local: storageArea("local", storageChanged),
      session: storageArea("session", storageChanged)
    },
    alarms: {
      onAlarm: event(),
      async create(name, info) { alarms.set(name, info); },
      async clear(name) { return alarms.delete(name); }
    },
    action: {
      async setIcon({ path }) { test.icon = path["16"]; },
      async setBadgeText() {},
      async setBadgeBackgroundColor() {},
      async setTitle() {}
    },
    commands: { onCommand: event() },
    webNavigation: {
      onBeforeNavigate: event(),
      onErrorOccurred: event()
    },
    windows: {
      onCreated: event(),
      async getCurrent() { return { id: 1 }; },
      async getLastFocused() {
        const all = [...windows.values()];
        return { ...(all.find((item) => item.focused) ?? all[0]) };
      },
      async getAll() { return [...windows.values()].map((item) => ({ ...item })); },
      async get(windowId) {
        if (!windows.has(windowId)) throw new Error(`No window with id: ${windowId}.`);
        return { ...windows.get(windowId) };
      },
      async create({ url = "chrome://newtab/", state = "normal", focused = true } = {}) {
        const id = nextWindowId++;
        if (focused) for (const other of windows.values()) other.focused = false;
        // Edge 156 opens the window "normal" when asked for full screen at creation, and
        // ignores the first change of state requested while the window is still opening.
        windows.set(id, { id, type: "normal", state: state === "fullscreen" ? "normal" : state, focused, opening: true });
        const tab = await chrome.tabs.create({ windowId: id, url, active: true });
        chrome.windows.onCreated.emit({ id, type: "normal", state });
        return { ...windows.get(id), tabs: [tab] };
      },
      async update(windowId, changes) {
        if (!windows.has(windowId)) throw new Error(`No window with id: ${windowId}.`);
        const window = windows.get(windowId);
        if (window.opening) {
          window.opening = false;
          return { ...window };
        }
        Object.assign(window, changes);
        return { ...windows.get(windowId) };
      },
      async remove(windowId) {
        for (const tab of [...tabs.values()].filter((item) => item.windowId === windowId)) {
          test.closeTab(tab.id, { isWindowClosing: true });
        }
        windows.delete(windowId);
      }
    },
    power: {
      requestKeepAwake(level) { test.keepAwake = level; },
      releaseKeepAwake() { test.keepAwake = null; }
    },
    tabs: {
      onUpdated: event(),
      onActivated: event(),
      onRemoved: event(),
      async create({ windowId = 1, url = "chrome://newtab/", active = true }) {
        const tab = { id: nextTabId++, windowId, url, title: url, status: "loading", active: false, autoDiscardable: true };
        // Opening a tab takes its window out of full screen (switching or closing tabs does not).
        if (windows.get(windowId)?.state === "fullscreen") windows.get(windowId).state = "normal";
        tabs.set(tab.id, tab);
        if (active) activate(tab);
        startLoad(tab);
        return { ...tab };
      },
      async update(tabId, changes) {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}.`);
        if ("autoDiscardable" in changes) tab.autoDiscardable = changes.autoDiscardable;
        if (changes.url) {
          tab.url = changes.url;
          startLoad(tab);
        }
        if (changes.active && !tab.active) activate(tab);
        return { ...tab };
      },
      async get(tabId) {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}.`);
        return withIndex(tab);
      },
      async query({ windowId } = {}) {
        return [...tabs.values()].filter((tab) => windowId === undefined || tab.windowId === windowId).map(withIndex);
      },
      async setZoomSettings(tabId, settings) {
        if (test.zoomFails) throw new Error("Cannot zoom this page.");
        if (settings.scope !== "per-tab") throw new Error("Lepidox only zooms per tab.");
      },
      async setZoom(tabId, factor) {
        if (test.zoomFails) throw new Error("Cannot zoom this page.");
        test.zoom.set(tabId, factor);
      },
      async reload(tabId) {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}.`);
        test.reloads.push(tabId);
        startLoad(tab);
      },
      async remove(tabIds) {
        for (const tabId of [tabIds].flat()) test.closeTab(tabId);
      }
    }
  };

  test.resetWindows();
  globalThis.chrome = chrome;
  return chrome;
}
