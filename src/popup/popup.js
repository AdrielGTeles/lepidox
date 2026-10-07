// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

import { MESSAGE, SCREEN_STATUS, STORAGE_KEYS } from "../core/constants.js";
import {
  createList,
  createScreen,
  cycleSeconds,
  isValidScreenUrl,
  rotationScreens,
  uniqueListName
} from "../core/lists.js";
import { getLists, patchScreenMeta, saveLists } from "../core/storage.js";
import { plural, t } from "../shared/i18n.js";
import { $, el, formatClock, formatDuration, localize, runAction, send, toast } from "../ui/dom.js";
import { icon } from "../ui/icons.js";

const SEARCH_THRESHOLD = 8;

let session = null;
let lists = [];
let shortcuts = {};
let shownIndex = null;

function withShortcut(label, command) {
  return shortcuts[command] ? `${label} (${shortcuts[command]})` : label;
}

function currentScreen() {
  return session?.screens[session.currentIndex] ?? null;
}

function sessionStatus() {
  const status = currentScreen()?.status;
  if (session.error || status === SCREEN_STATUS.ERROR) return { label: t("statusAttention"), pill: "pillError" };
  if (status === SCREEN_STATUS.AUTH) return { label: t("statusAuth"), pill: "pillAuth" };
  if (session.paused) return { label: t("statusPaused"), pill: "pillPaused" };
  if (session.loading || status === SCREEN_STATUS.LOADING) return { label: t("statusLoading"), pill: "pillLoading" };
  return { label: t("statusRunning"), pill: "pillRunning" };
}

function sessionAlert() {
  const status = currentScreen()?.status;
  if (session.error) return { text: session.error, kind: "alertError" };
  if (status === SCREEN_STATUS.AUTH) return { text: t("alertAuth"), kind: "alertWarning" };
  if (status === SCREEN_STATUS.ERROR) return { text: t("alertLoadError"), kind: "alertError" };
  return null;
}

function renderSession() {
  $("#session").classList.toggle("hidden", !session);
  if (!session) return;

  const { label, pill } = sessionStatus();
  const statusPill = $("#statusPill");
  statusPill.className = `pill ${pill}`;
  statusPill.textContent = label;

  const total = session.screens.length;
  $("#counter").textContent = total ? t("counter", session.currentIndex + 1, total) : "";
  $("#currentScreen").textContent = currentScreen()?.title ?? "";
  $("#activeListName").textContent = session.listName;

  const alert = sessionAlert();
  const alertBox = $("#sessionAlert");
  alertBox.className = alert ? `alert ${alert.kind}` : "alert hidden";
  alertBox.textContent = alert?.text ?? "";

  const pauseResume = $("#pauseResume");
  pauseResume.replaceChildren(
    icon(session.paused ? "play" : "pause"),
    session.paused ? t("resume") : t("pause")
  );
  pauseResume.title = withShortcut(session.paused ? t("resume") : t("pause"), "toggle-pause");

  for (const id of ["previous", "next"]) $(`#${id}`).disabled = total < 2;
  updateTimer();
}

function updateTimer() {
  if (!session) return;
  const label = $("#timerLabel");
  const value = $("#countdown");
  const bar = $("#progressBar");
  $("#progress").classList.toggle("paused", session.paused);

  if (session.paused) {
    label.textContent = t("timerPaused");
    value.textContent = "";
    bar.style.width = "100%";
  } else if (session.loading) {
    label.textContent = t("timerLoading");
    value.textContent = "";
    bar.style.width = "0";
  } else if (!session.nextRotationAt) {
    label.textContent = session.screens.length < 2 ? t("timerSingle") : "";
    value.textContent = "";
    bar.style.width = "0";
  } else {
    const remaining = Math.max(0, session.nextRotationAt - Date.now());
    label.textContent = t("timerNext");
    value.textContent = formatClock(remaining / 1000);
    const elapsed = session.rotationMs ? 1 - remaining / session.rotationMs : 0;
    bar.style.width = `${Math.round(Math.min(1, Math.max(0, elapsed)) * 100)}%`;
  }
}

function screenNote(screen, isCurrent) {
  if (screen.status === SCREEN_STATUS.AUTH) return { text: t("noteAuth"), kind: "auth" };
  if (screen.status === SCREEN_STATUS.ERROR) return { text: t("noteError"), kind: "error" };
  if (isCurrent) return { text: t("noteNow"), kind: "" };
  return { text: formatDuration(screen.duration), kind: "" };
}

function renderScreens() {
  const section = $("#screens");
  section.classList.toggle("hidden", !session || session.screens.length === 0);
  if (!session) return;

  const search = $("#screenSearch");
  search.classList.toggle("hidden", session.screens.length <= SEARCH_THRESHOLD);
  const needle = search.classList.contains("hidden") ? "" : search.value.trim().toLowerCase();

  const container = $("#screenList");
  const scrollTop = container.scrollTop;
  const items = [];

  session.screens.forEach((screen, index) => {
    if (needle && !`${screen.title} ${screen.url}`.toLowerCase().includes(needle)) return;
    const isCurrent = index === session.currentIndex;
    const note = screenNote(screen, isCurrent);
    const button = el("button", {
      type: "button",
      class: `screenItem${isCurrent ? " current" : ""}`,
      title: screen.url,
      disabled: isCurrent,
      "aria-current": isCurrent ? "true" : null,
      onclick: () => runAction(button, async () => {
        session = await send(MESSAGE.JUMP_TO, { index });
        render();
      })
    },
      el("span", { class: "indexBadge" }, index + 1),
      el("span", { class: "screenName" }, screen.title),
      el("span", { class: `screenNote ${note.kind}` }, note.text)
    );
    items.push(el("li", {}, button));
  });

  container.replaceChildren(...items);
  if (!items.length) container.append(el("li", { class: "noMatch" }, t("noScreenMatches")));

  // Keep the reader's place, but follow the rotation when the screen changes.
  container.scrollTop = scrollTop;
  if (shownIndex !== session.currentIndex) {
    shownIndex = session.currentIndex;
    container.querySelector(".current")?.scrollIntoView({ block: "nearest" });
  }
}

function listSummary(list) {
  const count = rotationScreens(list).length;
  if (!count) return t("noValidScreens");
  return `${plural(count, "screensOne", "screensMany")} · ${t("cycleOf", formatDuration(cycleSeconds(list)))}`;
}

function listItem(list) {
  const startable = rotationScreens(list).length > 0;
  const start = el("button", {
    type: "button",
    class: "button buttonPrimary buttonSmall",
    disabled: !startable,
    title: startable ? null : t("listHasNoScreens"),
    onclick: () => runAction(start, async () => {
      const currentWindow = await chrome.windows.getCurrent();
      session = await send(MESSAGE.START_LIST, { listId: list.id, windowId: currentWindow.id });
      render();
    })
  }, icon("play"), t("start"));

  return el("li", { class: "listItem" },
    el("div", { class: "listInfo" },
      el("strong", {}, list.name),
      el("span", {}, listSummary(list))
    ),
    start
  );
}

function renderLists() {
  const others = lists.filter((list) => list.id !== session?.listId);

  $("#empty").classList.toggle("hidden", lists.length > 0 || Boolean(session));
  $("#lists").classList.toggle("hidden", Boolean(session) || lists.length === 0);
  $("#switchList").classList.toggle("hidden", !session || others.length === 0);

  $("#listItems").replaceChildren(...(session ? [] : lists.map(listItem)));
  $("#otherListItems").replaceChildren(...(session ? others.map(listItem) : []));
}

function render() {
  renderSession();
  renderScreens();
  renderLists();
}

async function refresh() {
  [session, lists] = await Promise.all([send(MESSAGE.GET_STATE), getLists()]);
  render();
}

let refreshTimer = null;

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refresh().catch(console.error), 80);
}

async function openOptions(intent) {
  await chrome.storage.session.set({ [STORAGE_KEYS.OPTIONS_INTENT]: { ...intent, at: Date.now() } });
  await chrome.runtime.openOptionsPage();
}

async function createListFromTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const pages = [...new Map(tabs.filter((tab) => isValidScreenUrl(tab.url)).map((tab) => [tab.url, tab])).values()];
  if (!pages.length) throw new Error(t("noOpenPages"));

  const screens = pages.map((tab) => createScreen({ url: tab.url }));
  const existing = await getLists();
  const list = createList({ name: uniqueListName(existing, t("defaultListName")), screens });

  // Seed the automatic names with the titles the tabs already show.
  await patchScreenMeta(Object.fromEntries(
    screens.map((screen, index) => [screen.id, { title: pages[index].title || "" }])
  ));
  lists = await saveLists([...existing, list]);
  render();
  toast(plural(screens.length, "listCreatedOne", "listCreatedMany"), { type: "success" });
}

function command(type) {
  return async () => {
    session = await send(type);
    render();
  };
}

function bindEvents() {
  const actions = {
    pauseResume: () => command(session?.paused ? MESSAGE.RESUME : MESSAGE.PAUSE)(),
    previous: command(MESSAGE.PREVIOUS),
    next: command(MESSAGE.NEXT),
    stop: command(MESSAGE.STOP),
    createFromTabs: createListFromTabs,
    createManually: () => openOptions({ action: "new" }),
    newList: () => openOptions({ action: "new" }),
    openOptions: () => openOptions({ action: "select", listId: session?.listId ?? null })
  };
  for (const [id, action] of Object.entries(actions)) {
    const button = $(`#${id}`);
    button.addEventListener("click", () => runAction(button, action));
  }

  $("#screenSearch").addEventListener("input", renderScreens);

  chrome.storage.onChanged.addListener((changes, area) => {
    const relevant = area === "session"
      ? changes[STORAGE_KEYS.RUNTIME]
      : changes[STORAGE_KEYS.LISTS] || changes[STORAGE_KEYS.SCREEN_META];
    if (relevant) scheduleRefresh();
  });
}

localize();
shortcuts = Object.fromEntries((await chrome.commands.getAll()).map((item) => [item.name, item.shortcut]));
$("#previous").title = withShortcut(t("previous"), "previous-screen");
$("#next").title = withShortcut(t("next"), "next-screen");
$("#stop").title = withShortcut(t("stop"), "stop-rotation");
$("#previous").setAttribute("aria-label", t("previous"));
$("#next").setAttribute("aria-label", t("next"));

bindEvents();
await refresh();
setInterval(updateTimer, 250);
