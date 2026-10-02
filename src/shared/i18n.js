// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

// Works in the service worker and in extension pages alike.
export function t(key, ...substitutions) {
  return chrome.i18n.getMessage(key, substitutions.map(String)) || key;
}

// chrome.i18n has no plural rules, so each countable message has two keys.
export function plural(count, oneKey, manyKey) {
  return t(count === 1 ? oneKey : manyKey, count);
}
