// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

import { t } from "../shared/i18n.js";

const ICON_SIZES = [16, 32, 48, 128];

const STATES = {
  inactive: { badge: "", color: "#53667d", title: "actionTitleInactive" },
  active: { badge: "ON", color: "#62b58f", title: "actionTitleActive" },
  paused: { badge: "II", color: "#c4a95a", title: "actionTitlePaused" },
  error: { badge: "!", color: "#d86973", title: "actionTitleError" }
};

let lastState = null;

function iconPaths(state) {
  return Object.fromEntries(
    ICON_SIZES.map((size) => [String(size), `/assets/icons/lepidox-${state}-${size}.png`])
  );
}

function stateFor(runtime) {
  if (runtime?.error) return "error";
  if (runtime?.running && runtime?.paused) return "paused";
  if (runtime?.running) return "active";
  return "inactive";
}

export async function syncActionState(runtime) {
  const state = stateFor(runtime);
  if (state === lastState) return;
  lastState = state;

  const { badge, color, title } = STATES[state];
  await Promise.all([
    chrome.action.setIcon({ path: iconPaths(state) }),
    chrome.action.setBadgeText({ text: badge }),
    chrome.action.setBadgeBackgroundColor({ color }),
    chrome.action.setTitle({ title: t(title) })
  ]);
}
