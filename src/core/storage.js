// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

import { STORAGE_KEYS } from "./constants.js";
import { createList } from "./lists.js";

// Lists hold only what the user configured. What Lepidox observes about a screen
// (page title, last status) lives under SCREEN_META so the service worker never
// has to rewrite a list the options page may be editing.

export async function getLists() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LISTS);
  const raw = Array.isArray(result[STORAGE_KEYS.LISTS]) ? result[STORAGE_KEYS.LISTS] : [];
  return raw.map(createList);
}

export async function saveLists(lists) {
  const normalized = (Array.isArray(lists) ? lists : []).map(createList);
  await chrome.storage.local.set({ [STORAGE_KEYS.LISTS]: normalized });
  return normalized;
}

export async function getScreenMeta() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SCREEN_META);
  const meta = result[STORAGE_KEYS.SCREEN_META];
  return meta && typeof meta === "object" ? meta : {};
}

let metaQueue = Promise.resolve();

function updateScreenMeta(mutate) {
  const run = metaQueue.then(async () => {
    const meta = await getScreenMeta();
    if (mutate(meta) === false) return;
    await chrome.storage.local.set({ [STORAGE_KEYS.SCREEN_META]: meta });
  });
  metaQueue = run.catch(() => {});
  return run;
}

// patches: { [screenId]: { title?, status?, finalUrl? } }
export function patchScreenMeta(patches) {
  return updateScreenMeta((meta) => {
    let changed = false;
    for (const [screenId, patch] of Object.entries(patches)) {
      const current = meta[screenId] ?? {};
      const differs = Object.entries(patch).some(([key, value]) => current[key] !== value);
      if (!differs) continue;
      meta[screenId] = { ...current, ...patch, seenAt: Date.now() };
      changed = true;
    }
    return changed;
  });
}

export function pruneScreenMeta(lists) {
  const known = new Set(lists.flatMap((list) => list.screens.map((screen) => screen.id)));
  return updateScreenMeta((meta) => {
    const stale = Object.keys(meta).filter((screenId) => !known.has(screenId));
    stale.forEach((screenId) => delete meta[screenId]);
    return stale.length > 0;
  });
}

export async function getRuntime() {
  const result = await chrome.storage.session.get(STORAGE_KEYS.RUNTIME);
  return result[STORAGE_KEYS.RUNTIME] ?? null;
}

export async function saveRuntime(runtime) {
  if (runtime) {
    await chrome.storage.session.set({ [STORAGE_KEYS.RUNTIME]: runtime });
  } else {
    await chrome.storage.session.remove(STORAGE_KEYS.RUNTIME);
  }
}

export async function getRecovery() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.RECOVERY);
  return result[STORAGE_KEYS.RECOVERY] ?? null;
}

export async function saveRecovery(recovery) {
  if (recovery) {
    await chrome.storage.local.set({ [STORAGE_KEYS.RECOVERY]: recovery });
  } else {
    await chrome.storage.local.remove(STORAGE_KEYS.RECOVERY);
  }
}

// 1.0 kept resolvedTitle/lastStatus inside each screen. Move them to SCREEN_META
// and rewrite the lists in the current schema.
export async function migrateStorage() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LISTS);
  const raw = result[STORAGE_KEYS.LISTS];
  if (!Array.isArray(raw)) return;

  const patches = {};
  for (const list of raw) {
    for (const screen of list?.screens ?? []) {
      if (!screen?.id || (!screen.resolvedTitle && !screen.lastStatus)) continue;
      patches[screen.id] = {
        title: String(screen.resolvedTitle ?? ""),
        status: screen.lastStatus || "cold",
        finalUrl: String(screen.finalUrl ?? "")
      };
    }
  }

  if (Object.keys(patches).length) await patchScreenMeta(patches);
  await saveLists(raw);
}
