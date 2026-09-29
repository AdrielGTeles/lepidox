// SPDX-License-Identifier: MPL-2.0

import { MESSAGE, SCREEN_STATUS } from "../core/constants.js";
import { getLists } from "../core/storage.js";
import { numberedScreenTitle, screenTitle } from "../shared/naming.js";

const $ = (selector) => document.querySelector(selector);
let state = { runtime: null, list: null };
let tickId = null;
let allLists = [];

async function send(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...extra });
  if (!response?.ok) throw new Error(response?.error ?? "Falha desconhecida.");
  return response.data;
}

function toast(text) {
  const el = $("#message");
  el.textContent = text;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 3200);
}

function runtimeEntry(index) {
  return state.runtime?.pool?.find((entry) => entry.index === index) ?? null;
}

function statusFor(index, screen) {
  const entry = runtimeEntry(index);
  if (entry) return entry.status || SCREEN_STATUS.READY;
  return screen.lastStatus || SCREEN_STATUS.COLD;
}

function effectiveDuration(screen, list) {
  return Number(screen.duration ?? list.defaultDuration ?? 30);
}

function renderScreenList(filter = "") {
  const container = $("#screenList");
  container.innerHTML = "";
  const { runtime, list } = state;
  if (!runtime || !list) return;

  const needle = filter.trim().toLowerCase();
  list.screens.forEach((screen, index) => {
    const title = numberedScreenTitle(screen, index);
    const haystack = `${title} ${screen.url}`.toLowerCase();
    if (needle && !haystack.includes(needle)) return;

    const button = document.createElement("button");
    button.className = `screenRow${index === runtime.currentIndex ? " current" : ""}`;
    button.dataset.index = String(index);
    button.title = screen.url;

    const dot = document.createElement("span");
    const status = statusFor(index, screen);
    dot.className = `screenDot ${status}`;
    dot.title = status;

    const text = document.createElement("span");
    text.className = "screenText";
    text.textContent = title;

    const duration = document.createElement("span");
    duration.className = "screenDuration";
    duration.textContent = `${effectiveDuration(screen, list)}s`;

    button.append(dot, text, duration);
    button.addEventListener("click", async () => {
      if (index === state.runtime?.currentIndex) return;
      try {
        button.disabled = true;
        await send(MESSAGE.JUMP_TO, { index });
        await refreshState();
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    });
    container.append(button);
  });
}

function renderSession() {
  const { runtime, list } = state;
  const session = $("#session");
  if (!runtime || !list) {
    session.classList.add("hidden");
    return;
  }

  session.classList.remove("hidden");
  $("#activeListName").textContent = list.name;
  $("#counter").textContent = `${String(runtime.currentIndex + 1).padStart(2, "0")} / ${String(list.screens.length).padStart(2, "0")}`;
  $("#currentScreen").textContent = screenTitle(list.screens[runtime.currentIndex], runtime.currentIndex);
  $("#pauseResume").textContent = runtime.paused ? "Continuar" : "Pausar";
  $("#poolInfo").textContent = `${runtime.pool?.length ?? 0} telas quentes`;

  const statusDot = $("#sessionDot");
  statusDot.className = "statusDot";
  const currentEntry = runtimeEntry(runtime.currentIndex);
  let status = "Rotacionando";
  if (runtime.error || currentEntry?.status === SCREEN_STATUS.ERROR) {
    status = "Atenção";
    statusDot.classList.add("error");
  } else if (currentEntry?.status === SCREEN_STATUS.AUTH) {
    status = "Login necessário";
    statusDot.classList.add("auth");
  } else if (runtime.pendingJump || currentEntry?.status === SCREEN_STATUS.LOADING) {
    status = "Carregando";
    statusDot.classList.add("loading");
  } else if (runtime.paused) {
    status = "Investigação pausada";
    statusDot.classList.add("paused");
  }
  $("#statusBadge").textContent = status;

  const error = $("#runtimeError");
  if (runtime.error) {
    error.textContent = runtime.error;
    error.classList.remove("hidden");
  } else {
    error.classList.add("hidden");
  }

  renderScreenList($("#screenSearch").value);
  updateCountdown();
}

function updateCountdown() {
  const { runtime, list } = state;
  const countdown = $("#countdown");
  const progress = $("#progressBar");
  if (!runtime || !list) return;

  if (runtime.paused) {
    countdown.textContent = "PAUSADO";
    progress.style.width = "100%";
    return;
  }
  if (runtime.pendingJump) {
    countdown.textContent = "carregando…";
    progress.style.width = "35%";
    return;
  }
  if (!runtime.nextRotationAt) {
    countdown.textContent = "—";
    progress.style.width = "0%";
    return;
  }

  const duration = effectiveDuration(list.screens[runtime.currentIndex], list);
  const remainingMs = Math.max(0, runtime.nextRotationAt - Date.now());
  const seconds = Math.ceil(remainingMs / 1000);
  countdown.textContent = `${seconds}s`;
  const elapsedRatio = Math.min(1, Math.max(0, 1 - remainingMs / (duration * 1000)));
  progress.style.width = `${Math.round(elapsedRatio * 100)}%`;
}

async function refreshState() {
  state = await send(MESSAGE.GET_STATE);
  renderSession();
  renderLists();
}

function renderLists() {
  const container = $("#lists");
  container.innerHTML = "";
  $("#empty").classList.toggle("hidden", allLists.length > 0);

  allLists.forEach((list) => {
    const item = document.createElement("div");
    item.className = `listItem${state.runtime?.listId === list.id ? " activeList" : ""}`;

    const meta = document.createElement("div");
    meta.className = "listMeta";
    const name = document.createElement("strong");
    name.textContent = list.name;
    const count = document.createElement("small");
    count.textContent = `${list.screens?.filter((screen) => screen.enabled !== false).length ?? 0} telas · ${list.defaultDuration ?? 30}s padrão`;
    meta.append(name, count);

    const start = document.createElement("button");
    start.className = "startButton";
    start.textContent = state.runtime?.listId === list.id ? "Reiniciar" : "Iniciar";
    start.addEventListener("click", async () => {
      try {
        start.disabled = true;
        const currentWindow = await chrome.windows.getCurrent();
        await send(MESSAGE.START_LIST, { listId: list.id, windowId: currentWindow.id });
        await refreshState();
      } catch (error) {
        toast(error.message);
      } finally {
        start.disabled = false;
      }
    });

    item.append(meta, start);
    container.append(item);
  });
}

$("#pauseResume").addEventListener("click", async () => {
  try {
    await send(state.runtime?.paused ? MESSAGE.RESUME : MESSAGE.PAUSE);
    await refreshState();
  } catch (error) { toast(error.message); }
});

$("#previous").addEventListener("click", async () => {
  try { await send(MESSAGE.PREVIOUS); await refreshState(); } catch (error) { toast(error.message); }
});

$("#next").addEventListener("click", async () => {
  try { await send(MESSAGE.NEXT); await refreshState(); } catch (error) { toast(error.message); }
});

$("#stop").addEventListener("click", async () => {
  try { await send(MESSAGE.STOP); await refreshState(); } catch (error) { toast(error.message); }
});

$("#screenSearch").addEventListener("input", (event) => renderScreenList(event.target.value));
$("#openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("#manageLists").addEventListener("click", () => chrome.runtime.openOptionsPage());

allLists = await getLists();
await refreshState();
tickId = setInterval(updateCountdown, 250);
window.addEventListener("unload", () => clearInterval(tickId));
