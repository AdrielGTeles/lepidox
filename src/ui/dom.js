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

// toast("Screen removed", { action: { label: "Undo", run: restore } })
export function toast(message, { type = "info", action = null, duration = 4000 } = {}) {
  const area = $("#toasts");
  if (!area) return;

  const item = el("div", { class: `toast ${type}`, role: "status" }, el("span", {}, message));
  if (action) {
    item.append(el("button", {
      type: "button",
      onclick: () => {
        item.remove();
        action.run();
      }
    }, action.label));
  }
  area.append(item);
  setTimeout(() => item.remove(), action ? Math.max(duration, 7000) : duration);
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
