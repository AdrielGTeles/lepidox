// SPDX-License-Identifier: MPL-2.0

import {
  DEFAULT_INVESTIGATION_POOL_SIZE,
  DEFAULT_ROTATION_SECONDS,
  MAX_INVESTIGATION_POOL_SIZE,
  MIN_ROTATION_SECONDS,
  STORAGE_KEYS
} from "./constants.js";

function uuid() {
  return crypto.randomUUID();
}

function normalizeDuration(value, fallback = DEFAULT_ROTATION_SECONDS, allowNull = false) {
  if (allowNull && (value === null || value === undefined || value === "")) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(MIN_ROTATION_SECONDS, Math.round(parsed));
}

function normalizeScreen(screen = {}, index = 0) {
  const generatedAlphaName = /^Tela\s+\d+$/i.test(String(screen.name ?? "").trim());
  return {
    id: screen.id || uuid(),
    name: generatedAlphaName ? "" : String(screen.name ?? "").trim(),
    resolvedTitle: String(screen.resolvedTitle ?? "").trim(),
    url: String(screen.url ?? "").trim(),
    duration: normalizeDuration(screen.duration, null, true),
    enabled: screen.enabled !== false,
    lastStatus: screen.lastStatus || "cold",
    lastSeenAt: Number(screen.lastSeenAt) || null,
    finalUrl: String(screen.finalUrl ?? "").trim(),
    order: Number.isFinite(Number(screen.order)) ? Number(screen.order) : index
  };
}

export function normalizeList(list = {}, index = 0) {
  const pool = Math.min(
    MAX_INVESTIGATION_POOL_SIZE,
    Math.max(3, Number(list.investigationPoolSize) || DEFAULT_INVESTIGATION_POOL_SIZE)
  );
  const defaultDuration = normalizeDuration(list.defaultDuration);
  const isAlphaSchema = list.investigationPoolSize === undefined && list.autoResume === undefined;
  const screens = Array.isArray(list.screens)
    ? list.screens.map((screen, screenIndex) => {
        const normalized = normalizeScreen(screen, screenIndex);
        // v0.1 copied the list duration into every screen, making later list-level
        // changes look ignored. In 1.0 those legacy values become inherited.
        if (isAlphaSchema) normalized.duration = null;
        return normalized;
      })
    : [];

  return {
    id: list.id || uuid(),
    name: String(list.name ?? `Lista ${index + 1}`).trim() || `Lista ${index + 1}`,
    defaultDuration,
    investigationPoolSize: pool % 2 === 0 ? Math.min(MAX_INVESTIGATION_POOL_SIZE, pool + 1) : pool,
    autoResume: Boolean(list.autoResume),
    screens
  };
}

export async function getLists() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.LISTS);
  const raw = Array.isArray(result[STORAGE_KEYS.LISTS]) ? result[STORAGE_KEYS.LISTS] : [];
  return raw.map(normalizeList);
}

export async function saveLists(lists) {
  const normalized = (Array.isArray(lists) ? lists : []).map(normalizeList);
  await chrome.storage.local.set({ [STORAGE_KEYS.LISTS]: normalized });
  return normalized;
}

export async function updateScreenMetadata(listId, screenId, patch) {
  const lists = await getLists();
  const list = lists.find((item) => item.id === listId);
  if (!list) return;
  const screen = list.screens.find((item) => item.id === screenId);
  if (!screen) return;
  Object.assign(screen, patch);
  await saveLists(lists);
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
