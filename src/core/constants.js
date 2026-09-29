// SPDX-License-Identifier: MPL-2.0

export const STORAGE_KEYS = {
  LISTS: "lepidoxLists",
  RUNTIME: "lepidoxRuntime",
  RECOVERY: "lepidoxRecovery"
};

export const ALARM_NAME = "lepidox:rotate";
export const MIN_ROTATION_SECONDS = 5;
export const DEFAULT_ROTATION_SECONDS = 30;
export const FAST_TIMER_THRESHOLD_MS = 30_000;
export const LOAD_TIMEOUT_MS = 45_000;
export const PREFLIGHT_TIMEOUT_MS = 20_000;
export const NORMAL_POOL_SIZE = 3;
export const DEFAULT_INVESTIGATION_POOL_SIZE = 5;
export const MAX_INVESTIGATION_POOL_SIZE = 7;

export const SCREEN_STATUS = {
  COLD: "cold",
  LOADING: "loading",
  READY: "ready",
  ACTIVE: "active",
  AUTH: "auth",
  ERROR: "error"
};

export const MESSAGE = {
  GET_STATE: "GET_STATE",
  START_LIST: "START_LIST",
  STOP: "STOP",
  PAUSE: "PAUSE",
  RESUME: "RESUME",
  NEXT: "NEXT",
  PREVIOUS: "PREVIOUS",
  JUMP_TO: "JUMP_TO",
  PREFLIGHT_LIST: "PREFLIGHT_LIST",
  REFRESH_STATE: "REFRESH_STATE"
};
