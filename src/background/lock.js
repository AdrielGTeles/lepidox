// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

// Tab events, alarms, shortcuts and popup messages all read-modify-write the same
// runtime record. Running them one at a time keeps a slow handler from overwriting
// what a faster one just saved.
let tail = Promise.resolve();

export function exclusive(task) {
  const run = tail.then(task);
  tail = run.catch(() => {});
  return run;
}
