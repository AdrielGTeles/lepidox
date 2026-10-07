// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

import {
  DEFAULT_INVESTIGATION_POOL_SIZE,
  DEFAULT_ROTATION_SECONDS,
  INVESTIGATION_POOL_SIZES,
  MIN_ROTATION_SECONDS
} from "./constants.js";

function uuid() {
  return crypto.randomUUID();
}

export function normalizeDuration(value, fallback = DEFAULT_ROTATION_SECONDS, allowNull = false) {
  if (allowNull && (value === null || value === undefined || value === "")) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(MIN_ROTATION_SECONDS, Math.round(parsed));
}

export function isValidScreenUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Accepts what people actually paste: "grafana.local/d/abc" becomes an https URL.
export function normalizeUrl(value) {
  const text = String(value ?? "").trim();
  if (!text || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text;
  if (!/^(localhost|[^\s/:]+\.[^\s/:]+)(:\d+)?([/?#]|$)/i.test(text)) return text;
  const local = /^(localhost|\d{1,3}(\.\d{1,3}){3})([:/?#]|$)/i.test(text);
  const candidate = `${local ? "http" : "https"}://${text}`;
  return isValidScreenUrl(candidate) ? candidate : text;
}

export function createScreen(screen = {}) {
  // v0.1 stored generated "Tela N" names; an empty name now means "use the page title".
  const generatedAlphaName = /^Tela\s+\d+$/i.test(String(screen.name ?? "").trim());
  return {
    id: screen.id || uuid(),
    name: generatedAlphaName ? "" : String(screen.name ?? "").trim(),
    url: String(screen.url ?? "").trim(),
    duration: normalizeDuration(screen.duration, null, true),
    enabled: screen.enabled !== false
  };
}

export function createList(list = {}, index = 0) {
  const fallbackName = `List ${index + 1}`;
  const pool = Number(list.investigationPoolSize);
  const isAlphaSchema = list.investigationPoolSize === undefined && list.autoResume === undefined
    && Array.isArray(list.screens) && list.screens.length > 0;
  const screens = Array.isArray(list.screens)
    ? list.screens.map((screen) => {
        const normalized = createScreen(screen);
        // v0.1 copied the list duration into every screen, making later list-level
        // changes look ignored. Those legacy values become inherited.
        if (isAlphaSchema) normalized.duration = null;
        return normalized;
      })
    : [];

  return {
    id: list.id || uuid(),
    name: String(list.name ?? "").trim() || fallbackName,
    defaultDuration: normalizeDuration(list.defaultDuration),
    investigationPoolSize: INVESTIGATION_POOL_SIZES.includes(pool) ? pool : DEFAULT_INVESTIGATION_POOL_SIZE,
    autoResume: Boolean(list.autoResume),
    screens
  };
}

// The screens a rotation actually cycles through, in order.
export function rotationScreens(list) {
  return (list?.screens ?? []).filter((screen) => screen.enabled !== false && isValidScreenUrl(screen.url));
}

export function effectiveDuration(list, screen) {
  return normalizeDuration(screen?.duration ?? list?.defaultDuration);
}

export function cycleSeconds(list) {
  return rotationScreens(list).reduce((total, screen) => total + effectiveDuration(list, screen), 0);
}

export function uniqueListName(lists, base) {
  const names = new Set(lists.map((list) => list.name));
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}
