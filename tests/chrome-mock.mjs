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

  const test = {
    tabs,
    alarms,
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
    closeTab(tabId, removeInfo = {}) {
      const tab = tabs.get(tabId);
      if (!tab) return;
      tabs.delete(tabId);
      chrome.tabs.onRemoved.emit(tabId, { windowId: tab.windowId, isWindowClosing: false, ...removeInfo });
    },
    activeTab: (windowId = 1) => [...tabs.values()].find((tab) => tab.windowId === windowId && tab.active) ?? null
  };

  function startLoad(tab) {
    tab.status = "loading";
    chrome.tabs.onUpdated.emit(tab.id, { status: "loading", url: tab.url }, { ...tab });
    if (test.autoLoad) setTimeout(() => test.finishLoad(tab.id), 0);
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
    windows: {
      async getCurrent() { return { id: 1 }; },
      async getLastFocused() { return { id: 1 }; }
    },
    tabs: {
      onUpdated: event(),
      onActivated: event(),
      onRemoved: event(),
      async create({ windowId = 1, url = "chrome://newtab/", active = true }) {
        const tab = { id: nextTabId++, windowId, url, title: url, status: "loading", active: false, autoDiscardable: true };
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
        return { ...tab };
      },
      async query({ windowId } = {}) {
        return [...tabs.values()].filter((tab) => windowId === undefined || tab.windowId === windowId).map((tab) => ({ ...tab }));
      },
      async remove(tabIds) {
        for (const tabId of [tabIds].flat()) test.closeTab(tabId);
      }
    }
  };

  globalThis.chrome = chrome;
  return chrome;
}
