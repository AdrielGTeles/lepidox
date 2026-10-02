// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

import assert from "node:assert/strict";
import { test } from "node:test";

import { installChrome } from "./chrome-mock.mjs";

const chrome = installChrome();
const { STORAGE_KEYS } = await import("../src/core/constants.js");
const lists = await import("../src/core/lists.js");
const storage = await import("../src/core/storage.js");
const { detectPageState, fallbackTitle, screenTitle } = await import("../src/shared/naming.js");

test("normalizeUrl completes what people paste", () => {
  assert.equal(lists.normalizeUrl("  grafana.example.com/d/abc  "), "https://grafana.example.com/d/abc");
  assert.equal(lists.normalizeUrl("grafana.local:3000/d/abc"), "https://grafana.local:3000/d/abc");
  assert.equal(lists.normalizeUrl("localhost:3000"), "http://localhost:3000");
  assert.equal(lists.normalizeUrl("10.0.0.5:8080/board"), "http://10.0.0.5:8080/board");
  assert.equal(lists.normalizeUrl("http://plain.example/x"), "http://plain.example/x");
  assert.equal(lists.normalizeUrl("not a url"), "not a url");
  assert.equal(lists.normalizeUrl(""), "");
});

test("only http and https screens can rotate", () => {
  const list = lists.createList({
    name: "Wall",
    investigationPoolSize: 5,
    autoResume: false,
    screens: [
      { url: "https://a.test/" },
      { url: "ftp://a.test/" },
      { url: "" },
      { url: "https://b.test/", enabled: false },
      { url: "https://c.test/", duration: 60 }
    ]
  });
  assert.deepEqual(lists.rotationScreens(list).map((screen) => screen.url), ["https://a.test/", "https://c.test/"]);
  assert.equal(lists.cycleSeconds(list), 30 + 60);
});

test("createList clamps durations and pool size", () => {
  const list = lists.createList({ name: " ", defaultDuration: 1, investigationPoolSize: 4, autoResume: 1, screens: [{ url: "x", duration: 2 }] });
  assert.equal(list.name, "List 1");
  assert.equal(list.defaultDuration, 5);
  assert.equal(list.investigationPoolSize, 5);
  assert.equal(list.autoResume, true);
  assert.equal(list.screens[0].duration, 5);
  assert.deepEqual(lists.createList(list), list, "normalizing twice changes nothing");
});

test("uniqueListName avoids duplicates", () => {
  const existing = [{ name: "My list" }, { name: "My list 2" }];
  assert.equal(lists.uniqueListName(existing, "My list"), "My list 3");
  assert.equal(lists.uniqueListName(existing, "Other"), "Other");
});

test("screen names fall back from typed name to page title to address", () => {
  const screen = { name: "", url: "https://grafana.test/d/abc/payments" };
  assert.equal(screenTitle({ ...screen, name: "PIX" }, 0, "Page"), "PIX");
  assert.equal(screenTitle(screen, 0, "Page"), "Page");
  assert.equal(screenTitle(screen, 0), "grafana.test · payments");
  assert.equal(fallbackTitle("nonsense", 2), "Screen 3");
});

test("a sign-in is only reported after a redirect to a login page", () => {
  const configured = "https://grafana.test/d/abc/login-metrics";
  assert.equal(detectPageState(configured, "Login metrics - Grafana", configured), "ready");
  assert.equal(detectPageState("https://grafana.test/d/x/auth-service", "Auth service", "https://grafana.test/d/x/auth-service"), "ready");
  assert.equal(detectPageState("https://grafana.test/login", "Grafana", configured), "auth");
  assert.equal(detectPageState("https://login.microsoftonline.com/common/oauth2/authorize?x=1", "Sign in", configured), "auth");
  assert.equal(detectPageState("https://sso.corp.test/realms/x/protocol/openid-connect/auth", "", configured), "auth");
  assert.equal(detectPageState("https://grafana.test/d/abc/other", "Other", configured), "ready");
  assert.equal(detectPageState("chrome-error://chromewebdata/", "", configured), "error");
  assert.equal(detectPageState(configured, "This site can’t be reached", configured), "error");
});

test("migration moves observed data out of 1.0 lists", async () => {
  await chrome.storage.local.set({
    [STORAGE_KEYS.LISTS]: [{
      id: "l1",
      name: "Wall",
      defaultDuration: 20,
      investigationPoolSize: 7,
      autoResume: true,
      screens: [{
        id: "a", name: "", url: "https://a.test/", duration: 15, enabled: true,
        resolvedTitle: "Board A", lastStatus: "auth", lastSeenAt: 1, finalUrl: "https://a.test/login", order: 0
      }]
    }]
  });

  await storage.migrateStorage();

  assert.deepEqual(await storage.getLists(), [{
    id: "l1",
    name: "Wall",
    defaultDuration: 20,
    investigationPoolSize: 7,
    autoResume: true,
    screens: [{ id: "a", name: "", url: "https://a.test/", duration: 15, enabled: true }]
  }]);
  const meta = await storage.getScreenMeta();
  assert.equal(meta.a.title, "Board A");
  assert.equal(meta.a.status, "auth");
});

test("screen metadata is only written when it changes and is pruned with its screen", async () => {
  let writes = 0;
  const count = (changes) => { if (changes[STORAGE_KEYS.SCREEN_META]) writes += 1; };
  chrome.storage.onChanged.addListener(count);

  await storage.patchScreenMeta({ x: { title: "One", status: "ready" } });
  await storage.patchScreenMeta({ x: { title: "One", status: "ready" } });
  assert.equal(writes, 1);

  await storage.pruneScreenMeta([{ screens: [{ id: "a" }] }]);
  assert.equal((await storage.getScreenMeta()).x, undefined);
  chrome.storage.onChanged.removeListener(count);
});
