// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

import { t } from "../shared/i18n.js";
import { icon } from "./icons.js";

export const $ = (selector, root = document) => root.querySelector(selector);

// el("button", { class: "button", onclick: handler, title: "…" }, icon("play"), "Start")
// Text always goes through text nodes, so list names and page titles are never parsed as HTML.
export function el(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);

  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") element.className = value;
    else if (key === "dataset") Object.assign(element.dataset, value);
    else if (key.startsWith("on")) element.addEventListener(key.slice(2), value);
    else if (value === true) element.setAttribute(key, "");
    else element.setAttribute(key, value);
  }

  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

// Fills static markup: data-i18n="key" sets the text, data-i18n-attr="title:key,placeholder:key"
// sets attributes, data-icon="name" prepends an icon.
export function localize(root = document) {
  document.documentElement.lang = chrome.i18n.getUILanguage();

  for (const element of root.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of root.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of element.dataset.i18nAttr.split(",")) {
      const [attribute, key] = pair.split(":");
      element.setAttribute(attribute.trim(), t(key.trim()));
    }
  }
  for (const element of root.querySelectorAll("[data-icon]")) {
    element.prepend(icon(element.dataset.icon));
  }
}

const TOAST_MS = { info: 4000, success: 4000, error: 6000, action: 8000 };
let currentToast = null;

// One message at a time, shown in the slot the page keeps for it (#toasts), so it never
// covers anything. A new message replaces the current one. The countdown stops while
// the pointer or the keyboard focus is on the message.
// toast("Screen removed", { action: { label: "Undo", run: restore }, onClose })
//   → { update(message), dismiss() }; update() also restarts the countdown.
export function toast(message, { type = "info", action = null, duration, onClose = null } = {}) {
  currentToast?.dismiss();
  const area = $("#toasts");
  if (!area) return { update() {}, dismiss() {} };

  const total = duration ?? (action ? TOAST_MS.action : TOAST_MS[type] ?? TOAST_MS.info);
  const text = el("span", {}, message);
  const item = el("div", { class: `toast ${type}`, role: type === "error" ? "alert" : null }, text);
  let remaining = total;
  let startedAt = 0;
  let timer = null;
  let hovered = false;
  let focused = false;

  const handle = {
    update(next) {
      text.textContent = next;
      stop();
      remaining = total;
      go();
    },
    dismiss() {
      if (!item.isConnected) return;
      clearTimeout(timer);
      item.remove();
      if (currentToast === handle) currentToast = null;
      onClose?.();
    }
  };
  function stop() {
    if (!startedAt) return;
    clearTimeout(timer);
    remaining -= Date.now() - startedAt;
    startedAt = 0;
  }
  function go() {
    if (startedAt || hovered || focused) return;
    startedAt = Date.now();
    timer = setTimeout(handle.dismiss, Math.max(remaining, 1500));
  }

  if (action) {
    item.append(el("button", {
      type: "button",
      class: "toastAction",
      onclick: () => {
        handle.dismiss();
        action.run();
      }
    }, action.label));
  }
  item.append(el("button", {
    type: "button",
    class: "toastClose",
    title: t("dismiss"),
    "aria-label": t("dismiss"),
    onclick: handle.dismiss
  }, icon("close")));

  item.addEventListener("pointerenter", () => { hovered = true; stop(); });
  item.addEventListener("pointerleave", () => { hovered = false; go(); });
  item.addEventListener("focusin", () => { focused = true; stop(); });
  item.addEventListener("focusout", (event) => {
    if (item.contains(event.relatedTarget)) return;
    focused = false;
    go();
  });

  area.replaceChildren(item);
  currentToast = handle;
  go();
  return handle;
}

export async function send(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) throw new Error(response?.error || t("errorUnknown"));
  return response.data;
}

// Runs an async action from a button: blocks double clicks and reports failures.
// Uses aria-busy rather than `disabled`, which belongs to whoever renders the button.
export async function runAction(button, action) {
  if (button.getAttribute("aria-busy") === "true") return;
  button.setAttribute("aria-busy", "true");
  try {
    await action();
  } catch (error) {
    toast(error.message, { type: "error" });
  } finally {
    button.removeAttribute("aria-busy");
  }
}

export function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

// "45 s", "4 min", "4 min 30 s", "1 h 05 min"
export function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return t("durationSeconds", seconds);
  if (seconds < 3600) {
    const rest = seconds % 60;
    const minutes = Math.floor(seconds / 60);
    return rest ? t("durationMinutesSeconds", minutes, rest) : t("durationMinutes", minutes);
  }
  const minutes = Math.floor((seconds % 3600) / 60);
  return t("durationHoursMinutes", Math.floor(seconds / 3600), String(minutes).padStart(2, "0"));
}
