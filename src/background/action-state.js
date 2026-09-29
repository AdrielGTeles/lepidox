// SPDX-License-Identifier: MPL-2.0

const ICON_SIZES = [16, 32, 48, 128];

function iconPaths(state) {
  const safe = ["active", "paused", "error", "inactive"].includes(state) ? state : "inactive";
  return Object.fromEntries(
    ICON_SIZES.map((size) => [String(size), `assets/icons/lepidox-${safe}-${size}.png`])
  );
}

export async function syncActionState(runtime) {
  let state = "inactive";
  let badge = "";
  let badgeColor = "#53667d";
  let title = "Lepidox · Inativo";

  if (runtime?.error) {
    state = "error";
    badge = "!";
    badgeColor = "#d86973";
    title = "Lepidox · Atenção necessária";
  } else if (runtime?.running && runtime?.paused) {
    state = "paused";
    badge = "II";
    badgeColor = "#c4a95a";
    title = "Lepidox · Investigação pausada";
  } else if (runtime?.running) {
    state = "active";
    badge = "ON";
    badgeColor = "#62b58f";
    title = "Lepidox · Rotação ativa";
  }

  await Promise.all([
    chrome.action.setIcon({ path: iconPaths(state) }),
    chrome.action.setBadgeText({ text: badge }),
    chrome.action.setBadgeBackgroundColor({ color: badgeColor }),
    chrome.action.setTitle({ title })
  ]);
}
