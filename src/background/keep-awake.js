// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

let held = false;

// Keeps the display on while a list with keepAwake runs, paused or not. The request
// belongs to the extension, so a worker restart only needs it asked for again.
export function syncKeepAwake(runtime) {
  const wanted = Boolean(runtime?.keepAwake);
  if (wanted === held) return;
  held = wanted;
  if (wanted) chrome.power.requestKeepAwake("display");
  else chrome.power.releaseKeepAwake();
}
