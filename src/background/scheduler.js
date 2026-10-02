// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

import { ALARM_NAME, FAST_TIMER_THRESHOLD_MS } from "../core/constants.js";

let fastTimerId = null;

export async function clearScheduler() {
  if (fastTimerId !== null) {
    clearTimeout(fastTimerId);
    fastTimerId = null;
  }
  await chrome.alarms.clear(ALARM_NAME);
}

// Alarms cannot fire sooner than 30s, so short deadlines use an in-memory timer
// and keep an alarm only as a watchdog in case the worker is suspended.
export async function armDeadline(deadline, onDeadline) {
  await clearScheduler();
  const remaining = Math.max(0, deadline - Date.now());
  if (remaining < FAST_TIMER_THRESHOLD_MS) {
    fastTimerId = setTimeout(() => {
      fastTimerId = null;
      onDeadline().catch(console.error);
    }, remaining);
    await chrome.alarms.create(ALARM_NAME, { when: Date.now() + FAST_TIMER_THRESHOLD_MS });
  } else {
    await chrome.alarms.create(ALARM_NAME, { when: deadline });
  }
}
