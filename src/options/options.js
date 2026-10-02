// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

import {
  INVESTIGATION_POOL_SIZES,
  MESSAGE,
  MIN_ROTATION_SECONDS,
  SCREEN_STATUS,
  STORAGE_KEYS
} from "../core/constants.js";
import {
  createList,
  createScreen,
  cycleSeconds,
  isValidScreenUrl,
  normalizeDuration,
  normalizeUrl,
  rotationScreens,
  uniqueListName
} from "../core/lists.js";
import { getLists, getScreenMeta, patchScreenMeta, saveLists } from "../core/storage.js";
import { plural, t } from "../shared/i18n.js";
import { fallbackTitle } from "../shared/naming.js";
import { $, el, formatDuration, localize, runAction, send, toast } from "../ui/dom.js";
import { icon } from "../ui/icons.js";

let lists = [];
let meta = {};
let session = null;
let selectedId = null;

function selectedList() {
  return lists.find((list) => list.id === selectedId) ?? null;
}

// ---------------------------------------------------------------------------
// Saving. Every change is written straight away; there is no Save button.
// ---------------------------------------------------------------------------

let saveQueue = Promise.resolve();
const ownWrites = new Set();

function save() {
  $("#saveStatus").textContent = t("saving");
  saveQueue = saveQueue
    .then(async () => {
      const snapshot = lists.map(createList);
      // Lets the storage listener tell this write apart from one made elsewhere.
      ownWrites.add(JSON.stringify(snapshot));
      await saveLists(snapshot);
      $("#saveStatus").textContent = t("saved");
    })
    .catch((error) => {
      $("#saveStatus").textContent = t("saveFailed");
      toast(error.message, { type: "error" });
    });
  return saveQueue;
}

function commit() {
  renderNav();
  renderSummary();
  save();
}

// ---------------------------------------------------------------------------
// Sidebar and header
// ---------------------------------------------------------------------------

function listSummary(list) {
  const count = rotationScreens(list).length;
  if (!count) return t("noValidScreens");
  return `${plural(count, "screensOne", "screensMany")} · ${t("cycleOf", formatDuration(cycleSeconds(list)))}`;
}

function renderNav() {
  const items = lists.map((list) => {
    const running = session?.listId === list.id;
    return el("li", {},
      el("button", {
        type: "button",
        class: `navItem${list.id === selectedId ? " selected" : ""}`,
        "aria-current": list.id === selectedId ? "true" : null,
        onclick: () => select(list.id)
      },
        el("strong", {}, list.name),
        el("span", { class: "navSummary" }, listSummary(list)),
        running && el("span", { class: `pill ${session.paused ? "pillPaused" : "pillRunning"}` },
          session.paused ? t("statusPaused") : t("statusRunning"))
      )
    );
  });
  $("#listNav").replaceChildren(...items);
  if (!items.length) $("#listNav").append(el("li", { class: "navEmpty" }, t("navEmpty")));
}

function renderSessionChip() {
  const chip = $("#sessionChip");
  chip.classList.toggle("hidden", !session);
  if (!session) return;
  chip.className = `pill ${session.paused ? "pillPaused" : "pillRunning"}`;
  chip.textContent = t(session.paused ? "chipPaused" : "chipRunning", session.listName);
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function renderSummary() {
  const list = selectedList();
  if (!list) return;
  const startable = rotationScreens(list).length > 0;
  const running = session?.listId === list.id;

  $("#listSummary").textContent = startable
    ? t("summaryCycle", plural(rotationScreens(list).length, "screensOne", "screensMany"), formatDuration(cycleSeconds(list)))
    : t("summaryEmpty");
  $("#screenCount").textContent = String(list.screens.length);

  const startStop = $("#startStop");
  startStop.className = running ? "button buttonGhost dangerHover" : "button buttonPrimary";
  startStop.replaceChildren(icon(running ? "stop" : "play"), running ? t("stopRotation") : t("startRotation"));
  startStop.disabled = !running && !startable;
  $("#preflight").disabled = !startable;
}

function screenStatus(list, screen) {
  if (session?.listId === list.id) {
    const live = session.screens.find((item) => item.id === screen.id);
    if (live && live.status !== SCREEN_STATUS.COLD) return live.status;
  }
  return meta[screen.id]?.status;
}

function rowNote(list, screen) {
  if (!screen.url) return null;
  if (!isValidScreenUrl(screen.url)) return { text: t("noteUrlInvalid"), kind: "error" };
  const status = screenStatus(list, screen);
  if (status === SCREEN_STATUS.AUTH) return { text: t("noteNeedsLogin"), kind: "auth" };
  if (status === SCREEN_STATUS.ERROR) return { text: t("noteLoadFailed"), kind: "error" };
  return null;
}

// Updates what depends on other state without touching what the user is typing.
function refreshRow(row, list, screen, index) {
  row.classList.toggle("off", !screen.enabled);
  $(".indexBadge", row).textContent = String(index + 1);
  $(".screenUrl", row).setAttribute("aria-invalid", String(Boolean(screen.url) && !isValidScreenUrl(screen.url)));
  $(".screenName", row).placeholder = meta[screen.id]?.title
    || (isValidScreenUrl(screen.url) ? fallbackTitle(screen.url, index) : t("namePlaceholder"));
  $(".screenDuration", row).placeholder = String(list.defaultDuration);

  const note = rowNote(list, screen);
  const noteBox = $(".rowNote", row);
  noteBox.className = `rowNote ${note?.kind ?? ""}${note ? "" : " hidden"}`;
  noteBox.textContent = note?.text ?? "";
}

function refreshRows() {
  const list = selectedList();
  if (!list) return;
  list.screens.forEach((screen, index) => {
    const row = $(`.screenRow[data-id="${screen.id}"]`);
    if (row) refreshRow(row, list, screen, index);
  });
}

function moveScreen(list, fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= list.screens.length || fromIndex === toIndex) return false;
  const [screen] = list.screens.splice(fromIndex, 1);
  list.screens.splice(toIndex, 0, screen);
  renderScreens();
  commit();
  return true;
}

function removeScreen(list, screen) {
  const index = list.screens.indexOf(screen);
  list.screens.splice(index, 1);
  renderScreens();
  commit();
  toast(t("screenRemoved"), {
    action: {
      label: t("undo"),
      run: () => {
        if (!lists.includes(list)) return;
        list.screens.splice(Math.min(index, list.screens.length), 0, screen);
        if (selectedId === list.id) renderScreens();
        commit();
      }
    }
  });
}

function addScreens(list, screens, at = list.screens.length) {
  list.screens.splice(at, 0, ...screens);
  renderScreens();
  commit();
}

// Several addresses pasted at once (one per line) become one screen each.
function pastedUrls(text) {
  const lines = text.split(/\r?\n/).map((line) => normalizeUrl(line)).filter(Boolean);
  return lines.length > 1 && lines.every(isValidScreenUrl) ? lines : null;
}

let draggedId = null;

function screenRow(list, screen, index) {
  const number = index + 1;
  const handle = el("button", {
    type: "button",
    class: "dragHandle",
    title: t("reorderHint"),
    "aria-label": t("reorderScreen", number)
  }, icon("grip"));

  const url = el("input", {
    class: "input screenUrl",
    type: "url",
    inputmode: "url",
    spellcheck: "false",
    autocomplete: "off",
    placeholder: "https://",
    "aria-label": t("urlOfScreen", number)
  });
  url.value = screen.url;

  const name = el("input", { class: "input screenName", maxlength: "120", autocomplete: "off", "aria-label": t("nameOfScreen", number) });
  name.value = screen.name;

  const duration = el("input", {
    class: "input screenDuration",
    type: "number",
    min: String(MIN_ROTATION_SECONDS),
    step: "1",
    inputmode: "numeric",
    "aria-label": t("timeOfScreen", number)
  });
  duration.value = screen.duration ?? "";

  const enabled = el("input", { type: "checkbox", "aria-label": t("includeScreen", number) });
  enabled.checked = screen.enabled;

  const row = el("li", { class: "screenRow", dataset: { id: screen.id } },
    handle,
    el("span", { class: "indexBadge" }),
    el("div", { class: "urlCell" }, url),
    el("div", { class: "nameCell" }, name),
    duration,
    el("label", { class: "switch", title: t("colOnHelp") }, enabled, el("span", { class: "switchTrack" })),
    el("button", {
      type: "button",
      class: "button buttonGhost buttonIcon buttonSmall dangerHover",
      title: t("removeScreen"),
      "aria-label": t("removeScreenNumber", number),
      onclick: () => removeScreen(list, screen)
    }, icon("close")),
    el("p", { class: "rowNote hidden" })
  );

  url.addEventListener("change", () => {
    screen.url = normalizeUrl(url.value);
    url.value = screen.url;
    refreshRow(row, list, screen, list.screens.indexOf(screen));
    commit();
  });
  url.addEventListener("paste", (event) => {
    const urls = pastedUrls(event.clipboardData?.getData("text") ?? "");
    if (!urls) return;
    event.preventDefault();
    const at = list.screens.indexOf(screen);
    const [first, ...rest] = urls;
    // An empty row takes the first address; a filled one is left alone.
    if (!screen.url) screen.url = first;
    addScreens(list, (screen.url === first ? rest : urls).map((item) => createScreen({ url: item })), at + 1);
  });
  name.addEventListener("change", () => {
    screen.name = name.value.trim();
    name.value = screen.name;
    commit();
  });
  duration.addEventListener("change", () => {
    screen.duration = normalizeDuration(duration.value, null, true);
    duration.value = screen.duration ?? "";
    commit();
  });
  enabled.addEventListener("change", () => {
    screen.enabled = enabled.checked;
    refreshRow(row, list, screen, list.screens.indexOf(screen));
    commit();
  });

  // Reorder: drag the handle, or focus it and use the arrow keys.
  handle.addEventListener("pointerdown", () => { row.draggable = true; });
  handle.addEventListener("pointerup", () => { row.draggable = false; });
  handle.addEventListener("keydown", (event) => {
    const step = { ArrowUp: -1, ArrowDown: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const from = list.screens.indexOf(screen);
    if (moveScreen(list, from, from + step)) $(`.screenRow[data-id="${screen.id}"] .dragHandle`)?.focus();
  });
  row.addEventListener("dragstart", (event) => {
    draggedId = screen.id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", screen.url);
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", () => {
    draggedId = null;
    row.draggable = false;
    row.classList.remove("dragging");
  });
  row.addEventListener("dragover", (event) => {
    if (!draggedId || draggedId === screen.id) return;
    event.preventDefault();
    const bounds = row.getBoundingClientRect();
    const after = event.clientY > bounds.top + bounds.height / 2;
    row.classList.toggle("dropBefore", !after);
    row.classList.toggle("dropAfter", after);
  });
  row.addEventListener("dragleave", () => row.classList.remove("dropBefore", "dropAfter"));
  row.addEventListener("drop", (event) => {
    event.preventDefault();
    const after = row.classList.contains("dropAfter");
    row.classList.remove("dropBefore", "dropAfter");
    const from = list.screens.findIndex((item) => item.id === draggedId);
    if (from < 0) return;
    let to = list.screens.indexOf(screen) + (after ? 1 : 0);
    if (from < to) to -= 1;
    moveScreen(list, from, to);
  });

  refreshRow(row, list, screen, index);
  return row;
}

function renderScreens() {
  const list = selectedList();
  if (!list) return;
  $("#screenRows").replaceChildren(...list.screens.map((screen, index) => screenRow(list, screen, index)));
}

function renderEditor() {
  const list = selectedList();
  $("#editor").classList.toggle("hidden", !list);
  $("#welcome").classList.toggle("hidden", Boolean(list));
  if (!list) return;

  $("#listName").value = list.name;
  $("#defaultDuration").value = String(list.defaultDuration);
  $("#autoResume").checked = list.autoResume;
  for (const radio of document.querySelectorAll("#poolSize input")) {
    radio.checked = Number(radio.value) === list.investigationPoolSize;
  }
  $("#saveStatus").textContent = t("autosaveHint");
  renderScreens();
  renderSummary();
}

function render() {
  renderSessionChip();
  renderNav();
  renderEditor();
}

function select(listId) {
  selectedId = lists.some((list) => list.id === listId) ? listId : (lists[0]?.id ?? null);
  render();
}

// ---------------------------------------------------------------------------
// List actions
// ---------------------------------------------------------------------------

function newList() {
  const list = createList({ name: uniqueListName(lists, t("defaultListName")), screens: [createScreen()] });
  lists.push(list);
  select(list.id);
  save();
  $("#listName").select();
  return list;
}

async function duplicateList() {
  const source = selectedList();
  const copy = createList({
    ...source,
    id: undefined,
    name: uniqueListName(lists, t("copyOf", source.name)),
    screens: source.screens.map((screen) => ({ ...screen, id: undefined }))
  });

  // The copies are new screens: carry over the page titles already known.
  const titles = copy.screens
    .map((screen, index) => [screen.id, meta[source.screens[index].id]?.title])
    .filter(([, title]) => title)
    .map(([screenId, title]) => [screenId, { title }]);
  if (titles.length) {
    await patchScreenMeta(Object.fromEntries(titles));
    meta = await getScreenMeta();
  }

  lists.splice(lists.indexOf(source) + 1, 0, copy);
  select(copy.id);
  save();
}

function confirmDelete() {
  const list = selectedList();
  const dialog = $("#deleteDialog");
  $("#deleteMessage").textContent = t("deleteListMessage", list.name);
  dialog.returnValue = "cancel";
  dialog.onclose = () => {
    if (dialog.returnValue !== "confirm") return;
    const index = lists.indexOf(list);
    lists.splice(index, 1);
    select(lists[Math.min(index, lists.length - 1)]?.id ?? null);
    save();
    toast(t("listDeleted"));
  };
  dialog.showModal();
}

async function startOrStop() {
  const list = selectedList();
  if (session?.listId === list.id) {
    session = await send(MESSAGE.STOP);
  } else {
    await saveQueue;
    const currentWindow = await chrome.windows.getCurrent();
    session = await send(MESSAGE.START_LIST, { listId: list.id, windowId: currentWindow.id });
  }
  renderSessionChip();
  renderNav();
  renderSummary();
}

async function checkAccess() {
  const list = selectedList();
  const button = $("#preflight");
  const label = button.lastChild;
  label.textContent = t("checking");
  try {
    await saveQueue;
    const currentWindow = await chrome.windows.getCurrent();
    const results = await send(MESSAGE.PREFLIGHT_LIST, { listId: list.id, windowId: currentWindow.id });
    meta = await getScreenMeta();
    refreshRows();
    const logins = results.filter((item) => item.status === SCREEN_STATUS.AUTH).length;
    const failures = results.filter((item) => item.status === SCREEN_STATUS.ERROR).length;
    if (logins || failures) toast(t("checkProblems", logins, failures), { type: "error", duration: 7000 });
    else toast(t("checkAllGood"), { type: "success" });
  } finally {
    label.textContent = t("checkAccess");
  }
}

async function openTabsDialog() {
  const list = selectedList();
  const present = new Set(list.screens.map((screen) => screen.url));
  const tabs = await chrome.tabs.query({});
  const pages = [...new Map(
    tabs.filter((tab) => isValidScreenUrl(tab.url) && !present.has(tab.url)).map((tab) => [tab.url, tab])
  ).values()];
  if (!pages.length) throw new Error(t("noOpenPages"));

  const dialog = $("#tabsDialog");
  const confirm = $("#confirmTabs");
  const boxes = [];
  const updateConfirm = () => {
    const count = boxes.filter((box) => box.checked).length;
    confirm.textContent = plural(count, "addScreensOne", "addScreensMany");
    confirm.disabled = count === 0;
  };

  $("#tabChoices").replaceChildren(...pages.map((tab) => {
    const box = el("input", { type: "checkbox", checked: true, onchange: updateConfirm });
    boxes.push(box);
    return el("label", { class: "tabChoice" },
      box,
      el("div", {}, el("strong", {}, tab.title || tab.url), el("span", {}, tab.url))
    );
  }));
  updateConfirm();

  dialog.returnValue = "cancel";
  dialog.onclose = async () => {
    if (dialog.returnValue !== "confirm") return;
    const chosen = pages.filter((_tab, index) => boxes[index].checked);
    const screens = chosen.map((tab) => createScreen({ url: tab.url }));
    await patchScreenMeta(Object.fromEntries(
      screens.map((screen, index) => [screen.id, { title: chosen[index].title || "" }])
    ));
    meta = await getScreenMeta();
    // A list holding only its initial blank row starts from the chosen tabs.
    if (list.screens.length === 1 && !list.screens[0].url) list.screens.length = 0;
    addScreens(list, screens);
  };
  dialog.showModal();
}

function exportLists() {
  const payload = { format: "lepidox-lists", version: 2, exportedAt: new Date().toISOString(), lists: lists.map(createList) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  el("a", { href: url, download: `lepidox-lists-${new Date().toISOString().slice(0, 10)}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function importLists(file) {
  const parsed = JSON.parse(await file.text());
  const incoming = Array.isArray(parsed) ? parsed : parsed?.lists;
  if (!Array.isArray(incoming) || !incoming.length) throw new Error(t("importInvalid"));

  // Imported lists are added next to the existing ones, never merged into them.
  const imported = incoming.map((list) => createList({
    ...list,
    id: undefined,
    screens: (list?.screens ?? []).map((screen) => ({ ...screen, id: undefined }))
  }, lists.length));
  lists.push(...imported);
  select(imported[0].id);
  save();
  toast(plural(imported.length, "importedOne", "importedMany"), { type: "success" });
}

// ---------------------------------------------------------------------------
// Shortcuts, footer
// ---------------------------------------------------------------------------

async function renderShortcuts() {
  // getAll() sorts by name; this order reads better.
  const order = ["toggle-pause", "next-screen", "previous-screen", "stop-rotation"];
  const commands = (await chrome.commands.getAll())
    .filter((item) => order.includes(item.name))
    .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  $("#shortcutList").replaceChildren(...commands.map((item) =>
    el("div", {},
      el("dt", {}, item.description),
      el("dd", {}, item.shortcut
        ? item.shortcut.split("+").flatMap((key, index) => [index ? "+" : null, el("kbd", {}, key)])
        : t("shortcutUnset"))
    )
  ));
}

function renderFooter() {
  const manifest = chrome.runtime.getManifest();
  $("#versionLabel").textContent = `Lepidox ${manifest.version}`;
  $("#sourceLink").href = manifest.homepage_url;
  $("#privacyLink").href = `${manifest.homepage_url}/blob/main/PRIVACY.md`;
}

// ---------------------------------------------------------------------------
// Staying in sync with the service worker, the popup and other tabs
// ---------------------------------------------------------------------------

async function refreshSession() {
  session = await send(MESSAGE.GET_STATE);
  renderSessionChip();
  renderNav();
  renderSummary();
  refreshRows();
}

// The popup leaves a note here to say what the page should open on.
let lastIntentAt = 0;

async function consumeIntent() {
  const stored = await chrome.storage.session.get(STORAGE_KEYS.OPTIONS_INTENT);
  const intent = stored[STORAGE_KEYS.OPTIONS_INTENT];
  if (!intent || intent.at === lastIntentAt) return;
  lastIntentAt = intent.at;
  await chrome.storage.session.remove(STORAGE_KEYS.OPTIONS_INTENT);
  if (intent.action === "new") newList();
  else if (intent.listId) select(intent.listId);
}

function onStorageChanged(changes, area) {
  if (area === "session") {
    if (changes[STORAGE_KEYS.RUNTIME]) refreshSession().catch(console.error);
    if (changes[STORAGE_KEYS.OPTIONS_INTENT]?.newValue) consumeIntent().catch(console.error);
    return;
  }
  if (changes[STORAGE_KEYS.SCREEN_META]) {
    meta = changes[STORAGE_KEYS.SCREEN_META].newValue ?? {};
    refreshRows();
  }
  const listChange = changes[STORAGE_KEYS.LISTS];
  if (!listChange) return;
  // Storage hands objects back with their keys reordered; createList restores a stable shape.
  const stored = (listChange.newValue ?? []).map(createList);
  if (!ownWrites.delete(JSON.stringify(stored))) {
    // Changed by the popup or another options tab: show what is stored now.
    lists = stored;
    select(selectedId);
  }
}

function bindEvents() {
  const actions = {
    newList,
    welcomeNew: newList,
    welcomeFromTabs: async () => {
      const list = newList();
      try {
        await openTabsDialog();
      } catch (error) {
        // No tabs to offer: keep the new list and say why the picker did not open.
        if (lists.includes(list)) toast(error.message);
      }
    },
    addScreen: () => {
      const list = selectedList();
      addScreens(list, [createScreen()]);
      $(".screenRow:last-child .screenUrl")?.focus();
    },
    addTabs: openTabsDialog,
    preflight: checkAccess,
    startStop: startOrStop,
    duplicateList,
    deleteList: confirmDelete,
    exportLists,
    importLists: () => $("#importFile").click(),
    editShortcuts: () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" })
  };
  for (const [id, action] of Object.entries(actions)) {
    const button = $(`#${id}`);
    button.addEventListener("click", () => runAction(button, action));
  }

  $("#importFile").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file) return;
    try {
      await importLists(file);
    } catch (error) {
      toast(error instanceof SyntaxError ? t("importInvalid") : error.message, { type: "error" });
    }
  });

  $("#listName").addEventListener("change", (event) => {
    const list = selectedList();
    list.name = event.target.value.trim() || list.name;
    event.target.value = list.name;
    commit();
  });
  $("#defaultDuration").addEventListener("change", (event) => {
    const list = selectedList();
    list.defaultDuration = normalizeDuration(event.target.value, list.defaultDuration);
    event.target.value = String(list.defaultDuration);
    refreshRows();
    commit();
  });
  $("#autoResume").addEventListener("change", (event) => {
    selectedList().autoResume = event.target.checked;
    commit();
  });

  $("#poolSize").replaceChildren(...INVESTIGATION_POOL_SIZES.map((size) =>
    el("label", {},
      el("input", {
        type: "radio",
        name: "poolSize",
        value: String(size),
        onchange: () => {
          selectedList().investigationPoolSize = size;
          commit();
        }
      }),
      el("span", {}, size)
    )
  ));

  chrome.storage.onChanged.addListener(onStorageChanged);
}

localize();
$("#screenRows").dataset.empty = t("noScreensYet");
bindEvents();
renderFooter();

[lists, meta, session] = await Promise.all([getLists(), getScreenMeta(), send(MESSAGE.GET_STATE)]);
select(session?.listId ?? lists[0]?.id ?? null);
await renderShortcuts();
await consumeIntent();
