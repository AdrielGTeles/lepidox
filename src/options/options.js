// SPDX-License-Identifier: MPL-2.0

import {
  DEFAULT_INVESTIGATION_POOL_SIZE,
  DEFAULT_ROTATION_SECONDS,
  MESSAGE,
  MIN_ROTATION_SECONDS
} from "../core/constants.js";
import { getLists, saveLists } from "../core/storage.js";
import { fallbackTitle } from "../shared/naming.js";

const $ = (selector) => document.querySelector(selector);
const listTemplate = $("#listTemplate");
const screenTemplate = $("#screenTemplate");
let lists = [];

function uuid() {
  return crypto.randomUUID();
}

function newScreen() {
  return {
    id: uuid(), name: "", resolvedTitle: "", url: "", duration: null, enabled: true,
    lastStatus: "cold", lastSeenAt: null, finalUrl: ""
  };
}

function newList() {
  return {
    id: uuid(), name: "Nova lista", defaultDuration: DEFAULT_ROTATION_SECONDS,
    investigationPoolSize: DEFAULT_INVESTIGATION_POOL_SIZE, autoResume: false, screens: [newScreen()]
  };
}

function statusLabel(status) {
  return {
    cold: "Não carregada", loading: "Carregando", ready: "Pronta", active: "Ativa",
    auth: "Login necessário", error: "Erro"
  }[status] || "Não verificada";
}

function toast(message, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = `toast${error ? " error" : ""}`;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 3500);
}

function validateUrl(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
}

function validateList(list) {
  if (!list.name.trim()) throw new Error("Informe um nome para a lista.");
  if (Number(list.defaultDuration) < MIN_ROTATION_SECONDS) {
    throw new Error(`A rotação mínima é ${MIN_ROTATION_SECONDS} segundos.`);
  }
  const enabled = list.screens.filter((screen) => screen.enabled !== false);
  if (!enabled.length) throw new Error("Mantenha pelo menos uma tela ativa.");
  list.screens.forEach((screen, index) => {
    if (!screen.url.trim()) throw new Error(`Informe a URL da tela ${index + 1}.`);
    try { validateUrl(screen.url); } catch { throw new Error(`URL inválida na tela ${index + 1}.`); }
    if (screen.duration !== null && Number(screen.duration) < MIN_ROTATION_SECONDS) {
      throw new Error(`A duração da tela ${index + 1} deve ser de pelo menos ${MIN_ROTATION_SECONDS}s.`);
    }
  });
}

function updateCounters() {
  $("#listCount").textContent = `${lists.length} ${lists.length === 1 ? "lista" : "listas"}`;
  const count = lists.reduce((total, list) => total + list.screens.length, 0);
  $("#screenCount").textContent = `${count} ${count === 1 ? "tela configurada" : "telas configuradas"}`;
}

function readListFromCard(card, list) {
  list.name = card.querySelector(".listName").value.trim();
  list.defaultDuration = Math.max(MIN_ROTATION_SECONDS, Number(card.querySelector(".defaultDuration").value) || DEFAULT_ROTATION_SECONDS);
  list.investigationPoolSize = Number(card.querySelector(".investigationPool").value) || DEFAULT_INVESTIGATION_POOL_SIZE;
  list.autoResume = card.querySelector(".autoResume").checked;

  const rows = [...card.querySelectorAll(".screenRow")];
  list.screens = rows.map((row, index) => {
    const existingId = row.dataset.screenId || uuid();
    const old = list.screens.find((screen) => screen.id === existingId) ?? {};
    const durationValue = row.querySelector(".screenDuration").value.trim();
    return {
      ...old,
      id: existingId,
      name: row.querySelector(".screenName").value.trim(),
      url: row.querySelector(".screenUrl").value.trim(),
      duration: durationValue ? Math.max(MIN_ROTATION_SECONDS, Number(durationValue) || MIN_ROTATION_SECONDS) : null,
      enabled: row.querySelector(".screenEnabled").checked,
      order: index
    };
  });
  return list;
}

function renderScreenRow(screen, index, list, card) {
  const row = screenTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.screenId = screen.id;
  row.querySelector(".screenNumber").textContent = String(index + 1).padStart(2, "0");
  const statusDot = row.querySelector(".screenStatusDot");
  statusDot.className = `screenStatusDot ${screen.lastStatus || "cold"}`;
  row.querySelector(".screenStatusText").textContent = statusLabel(screen.lastStatus);
  row.querySelector(".screenName").value = screen.name || "";
  row.querySelector(".screenUrl").value = screen.url || "";
  row.querySelector(".screenDuration").value = screen.duration ?? "";
  row.querySelector(".screenEnabled").checked = screen.enabled !== false;

  const resolved = row.querySelector(".resolvedTitle");
  const title = screen.resolvedTitle || (screen.url ? fallbackTitle(screen.url, index) : "");
  resolved.textContent = screen.name ? (screen.resolvedTitle ? `Título detectado: ${screen.resolvedTitle}` : "") : (title ? `Automático: ${title}` : "");
  resolved.title = resolved.textContent;

  row.querySelector(".moveUp").disabled = index === 0;
  row.querySelector(".moveDown").disabled = index === list.screens.length - 1;
  row.querySelector(".moveUp").addEventListener("click", () => {
    readListFromCard(card, list);
    [list.screens[index - 1], list.screens[index]] = [list.screens[index], list.screens[index - 1]];
    render();
  });
  row.querySelector(".moveDown").addEventListener("click", () => {
    readListFromCard(card, list);
    [list.screens[index], list.screens[index + 1]] = [list.screens[index + 1], list.screens[index]];
    render();
  });
  row.querySelector(".removeScreen").addEventListener("click", () => {
    readListFromCard(card, list);
    list.screens.splice(index, 1);
    render();
  });
  return row;
}

function renderList(list, listIndex) {
  const card = listTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.listId = list.id;
  card.querySelector(".listIndex").textContent = String(listIndex + 1).padStart(2, "0");
  card.querySelector(".listTitle").textContent = list.name;
  card.querySelector(".listSummary").textContent = `${list.screens.length} telas · ${list.defaultDuration}s padrão · pool ${list.investigationPoolSize}`;
  card.querySelector(".listName").value = list.name;
  card.querySelector(".defaultDuration").value = String(list.defaultDuration ?? DEFAULT_ROTATION_SECONDS);
  card.querySelector(".investigationPool").value = String(list.investigationPoolSize ?? DEFAULT_INVESTIGATION_POOL_SIZE);
  card.querySelector(".autoResume").checked = Boolean(list.autoResume);

  const rows = card.querySelector(".screenRows");
  list.screens.forEach((screen, index) => rows.append(renderScreenRow(screen, index, list, card)));

  card.querySelector(".addScreen").addEventListener("click", () => {
    readListFromCard(card, list);
    list.screens.push(newScreen());
    render();
  });

  card.querySelector(".saveList").addEventListener("click", async () => {
    const status = card.querySelector(".saveStatus");
    try {
      readListFromCard(card, list);
      validateList(list);
      lists = await saveLists(lists);
      status.textContent = "Alterações salvas";
      status.className = "saveStatus success";
      toast("Lista salva com sucesso.");
      render();
    } catch (error) {
      status.textContent = error.message;
      status.className = "saveStatus error";
    }
  });

  card.querySelector(".deleteList").addEventListener("click", async () => {
    if (!confirm(`Excluir a lista “${list.name}”?`)) return;
    lists = lists.filter((item) => item.id !== list.id);
    lists = await saveLists(lists);
    render();
    toast("Lista excluída.");
  });

  card.querySelector(".preflight").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const status = card.querySelector(".saveStatus");
    try {
      readListFromCard(card, list);
      validateList(list);
      lists = await saveLists(lists);
      button.disabled = true;
      button.textContent = "Verificando…";
      status.textContent = "Abrindo as telas em segundo plano para validar sessão e carregamento.";
      const currentWindow = await chrome.windows.getCurrent();
      const response = await chrome.runtime.sendMessage({ type: MESSAGE.PREFLIGHT_LIST, listId: list.id, windowId: currentWindow.id });
      if (!response?.ok) throw new Error(response?.error || "Falha na verificação.");
      lists = await getLists();
      const auth = response.data.filter((item) => item.status === "auth").length;
      const errors = response.data.filter((item) => item.status === "error").length;
      status.textContent = errors || auth ? `${errors} erro(s), ${auth} login(s) necessário(s).` : "Todas as telas verificadas.";
      status.className = errors ? "saveStatus error" : "saveStatus success";
      render();
    } catch (error) {
      status.textContent = error.message;
      status.className = "saveStatus error";
    } finally {
      button.disabled = false;
      button.textContent = "Verificar acessos";
    }
  });

  return card;
}

function render() {
  const container = $("#lists");
  container.innerHTML = "";
  $("#empty").hidden = lists.length > 0;
  lists.forEach((list, index) => container.append(renderList(list, index)));
  updateCounters();
}

async function createList() {
  lists.push(newList());
  lists = await saveLists(lists);
  render();
  document.querySelector(`[data-list-id="${lists.at(-1).id}"] .listName`)?.focus();
}

$("#newList").addEventListener("click", createList);
document.querySelector("[data-create-list]").addEventListener("click", createList);

$("#exportLists").addEventListener("click", async () => {
  const payload = {
    format: "lepidox-lists",
    version: 1,
    exportedAt: new Date().toISOString(),
    lists: await getLists()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `lepidox-lists-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast("Listas exportadas.");
});

$("#importLists").addEventListener("click", () => $("#importFile").click());
$("#importFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = Array.isArray(parsed) ? parsed : parsed.lists;
    if (!Array.isArray(incoming)) throw new Error("Arquivo não contém uma coleção de listas do Lepidox.");
    const existingIds = new Set(lists.map((list) => list.id));
    const safeIncoming = incoming.map((list) => ({
      ...list,
      id: existingIds.has(list.id) ? uuid() : (list.id || uuid()),
      screens: (list.screens || []).map((screen) => ({ ...screen, id: screen.id || uuid() }))
    }));
    lists = await saveLists([...lists, ...safeIncoming]);
    render();
    toast(`${safeIncoming.length} lista(s) importada(s).`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    event.target.value = "";
  }
});

lists = await getLists();
render();
