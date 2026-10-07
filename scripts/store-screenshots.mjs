// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

// Rebuilds the six store screenshots and promotional tile from the real extension UI.
// The logo is always read from assets/icons/lepidox.svg.
//
// Run: node scripts/store-screenshots.mjs
// Requires the external development tool playwright-core and a Chromium browser
// that supports loading unpacked extensions. Neither is a runtime dependency.
// PLAYWRIGHT_MODULE may point to an existing playwright-core/index.mjs file.
// LEPIDOX_BROWSER_CHANNEL selects the browser (defaults to msedge on Windows,
// chromium elsewhere); PLAYWRIGHT_BROWSERS_PATH is respected by Playwright.
// LEPIDOX_STORE_OUT may select a review directory instead of store/.
// All captures run headlessly in fresh, temporary browser profiles.
import assert from "node:assert/strict";
import http from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./validate.mjs";
import { deflateSync, inflateSync, crc32 } from "node:zlib";
const playwrightModule = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(playwrightModule ? pathToFileURL(resolve(playwrightModule)).href : "playwright-core")
  .catch((error) => { throw new Error("Store screenshots require playwright-core. Set PLAYWRIGHT_MODULE to an existing installation's index.mjs.", { cause: error }); });

const EXT = root.replaceAll("\\", "/");
const OUT = process.env.LEPIDOX_STORE_OUT ? resolve(process.env.LEPIDOX_STORE_OUT) : `${EXT}/store`;
const logoSvg = readFileSync(`${EXT}/assets/icons/lepidox.svg`, "utf8");
const logoUrl = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;

const COPY = {
  en: {
    lang: "en-US",
    list: "Operations wall",
    screens: [
      ["payments", "Payments · Overview"],
      ["api-latency", "API Gateway · Latency"],
      ["checkout", "Checkout · Error rate"],
      ["k8s", "Kubernetes · Cluster health"],
      ["postgres", "PostgreSQL · Replication"],
      ["queues", "Queues · Backlog"],
      ["cdn", "CDN · Traffic"],
      ["billing", "Billing · Invoices"]
    ],
    hero: ["Your dashboards, on rotation.", "The next screen is already loaded, so every switch is instant.",
      ["Three tabs open, not thirty", "One time for the list, or per screen", "Pause, skip or stop from the toolbar"]],
    pause: ["Pause to investigate.", "Jump to any screen and see which ones need a sign-in.",
      ["Neighbouring screens stay ready while paused", "Sign-in redirects are flagged", "Edit the list without stopping the wall"]],
    tile: "Dashboard rotator"
  },
  pt_BR: {
    lang: "pt-BR",
    list: "Painel de operações",
    screens: [
      ["pagamentos", "Pagamentos · Visão geral"],
      ["api-latencia", "API Gateway · Latência"],
      ["checkout", "Checkout · Taxa de erros"],
      ["k8s", "Kubernetes · Saúde do cluster"],
      ["postgres", "PostgreSQL · Replicação"],
      ["filas", "Filas · Backlog"],
      ["cdn", "CDN · Tráfego"],
      ["faturamento", "Faturamento · Notas"]
    ],
    hero: ["Seus dashboards, em rotação.", "A próxima tela já está carregada: cada troca é imediata.",
      ["Três abas abertas, não trinta", "Um tempo para a lista ou por tela", "Pause, avance ou encerre pela barra do navegador"]],
    pause: ["Pause para investigar.", "Pule para qualquer tela e veja quais pedem login.",
      ["Telas vizinhas continuam prontas durante a pausa", "Redirecionamentos para login são sinalizados", "Edite a lista sem parar o telão"]]
  }
};

// Chromium writes RGBA PNGs; the Chrome Web Store asks for 24-bit PNG without alpha.
function toRgbPng(png) {
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    chunks.push({ type: png.toString("latin1", offset + 4, offset + 8), data: png.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  const header = chunks.find((chunk) => chunk.type === "IHDR").data;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  if (header[9] === 2) return png;
  assert.equal(header[8], 8);
  assert.equal(header[9], 6, "expected an RGBA PNG");
  assert.equal(header[12], 0, "interlaced PNG not supported");

  const raw = inflateSync(Buffer.concat(chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data)));
  const stride = width * 4;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[y * stride + x] = (line[x] + predictor) & 255;
    }
  }

  const rgb = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const out = y * (width * 3 + 1) + 1;
    for (let x = 0; x < width; x += 1) pixels.copy(rgb, out + x * 3, y * stride + x * 4, y * stride + x * 4 + 3);
  }

  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.from(header);
  ihdr[9] = 2;
  return Buffer.concat([png.subarray(0, 8), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rgb, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function save(path, png, { opaque = true } = {}) {
  writeFileSync(path, opaque ? toRgbPng(png) : png);
  console.log("wrote", path.replace(`${EXT}/`, ""));
}

function stageHtml([headline, sub, bullets], popupPng) {
  return `<!doctype html><meta charset="utf-8"><style>
    * { margin: 0; box-sizing: border-box; }
    body { width: 1280px; height: 800px; overflow: hidden; display: grid; grid-template-columns: 1fr 380px; align-items: center; gap: 72px; padding: 0 96px 0 88px;
      font-family: "Segoe UI", system-ui, sans-serif; color: #f8fafc;
      background: radial-gradient(1100px 640px at 8% -12%, rgba(37,99,235,.30), transparent 62%), radial-gradient(900px 560px at 108% 104%, rgba(6,182,212,.16), transparent 58%), #0b1220; }
    .brand { display: flex; align-items: center; gap: 14px; font-size: 26px; font-weight: 700; margin-bottom: 34px; }
    .brand img { width: 52px; height: 52px; }
    h1 { font-size: 54px; line-height: 1.08; letter-spacing: -1.2px; }
    p { margin-top: 18px; font-size: 22px; line-height: 1.4; color: #cbd5e1; max-width: 560px; }
    ul { margin-top: 34px; list-style: none; display: grid; gap: 14px; }
    li { display: flex; align-items: center; gap: 14px; font-size: 19px; color: #e2e8f0; }
    li::before { content: ""; flex: none; width: 10px; height: 10px; border-radius: 50%; background: #38bdf8; box-shadow: 0 0 0 5px rgba(56,189,248,.18); }
    .popup { width: 380px; border-radius: 14px; border: 1px solid #3b4b63; box-shadow: 0 30px 80px rgba(2,6,23,.7); display: block; }
  </style>
  <div><div class="brand"><img src="${logoUrl}">Lepidox</div><h1>${headline}</h1><p>${sub}</p><ul>${bullets.map((b) => `<li>${b}</li>`).join("")}</ul></div>
  <img class="popup" src="data:image/png;base64,${popupPng.toString("base64")}">`;
}

async function forLocale(locale) {
  const copy = COPY[locale];
  const titles = Object.fromEntries(copy.screens);
  const authPath = copy.screens.at(-1)[0];

  const server = http.createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const key = path.split("/").pop();
    if (key === authPath) { res.writeHead(302, { Location: "/login" }); return res.end(); }
    const title = path === "/login" ? "Sign in" : titles[key] ?? key;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="background:#0b1220"></body>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const profile = mkdtempSync(join(tmpdir(), "lepidox-store-"));
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profile, {
      channel: process.env.LEPIDOX_BROWSER_CHANNEL ?? (process.platform === "win32" ? "msedge" : "chromium"), headless: true, viewport: { width: 1280, height: 800 }, locale: copy.lang,
      args: [`--lang=${copy.lang}`, `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run",
        `--host-resolver-rules=MAP dashboards.example.com 127.0.0.1:${port}`]
    });
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 });
    const id = new URL(sw.url()).host;
    const dir = `${OUT}/screenshots/${locale}`;
    mkdirSync(dir, { recursive: true });

    const list = (scheme) => ({
      id: "demo", name: copy.list, defaultDuration: 30, investigationPoolSize: 5, autoResume: true,
      screens: copy.screens.map(([path, title], index) => ({
        id: `demo-${index}`, name: index === copy.screens.length - 1 ? title : "", url: `${scheme}://dashboards.example.com/d/${path}`,
        duration: index === 0 ? 60 : null, enabled: true
      }))
    });
    const meta = Object.fromEntries(copy.screens.slice(0, -1).map(([, title], index) => [`demo-${index}`, { title, status: "ready" }]));

    // 2. The options page, editing a list.
    await sw.evaluate(([lists, screenMeta]) => chrome.storage.local.set({ lepidoxLists: lists, lepidoxScreenMeta: screenMeta }), [[list("https")], meta]);
    const options = await ctx.newPage();
    await options.goto(`chrome-extension://${id}/src/options/options.html`);
    await options.waitForSelector("#editor:not(.hidden)");
    await options.waitForTimeout(400);
    save(`${dir}/02-lists.png`, await options.screenshot());
    await options.close();

    // 1. The popup while rotating.
    await sw.evaluate((lists) => chrome.storage.local.set({ lepidoxLists: lists }), [list("http")]);
    const popup = await ctx.newPage();
    await popup.setViewportSize({ width: 380, height: 300 });
    await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await popup.click(".listItem button");
    await popup.waitForSelector("#session:not(.hidden)");
    await popup.waitForFunction(() => document.querySelector("#countdown").textContent === "0:37", null, { timeout: 40000 });
    const rotating = await popup.screenshot({ fullPage: true });

    // 3. Paused for investigation, with a sign-in warning visible in the list.
    await popup.click("#pauseResume");
    await popup.waitForFunction(() => document.querySelector("#progress").classList.contains("paused"));
    await popup.locator(".screenItem").nth(4).click();
    await popup.waitForFunction(() => document.querySelector(".screenItem.current .indexBadge")?.textContent === "5", null, { timeout: 15000 });
    await popup.waitForTimeout(1500);
    await popup.locator(".screenList").evaluate((node) => { node.scrollTop = node.scrollHeight; });
    const paused = await popup.screenshot({ fullPage: true });

    const stage = await ctx.newPage();
    await stage.setViewportSize({ width: 1280, height: 800 });
    await stage.setContent(stageHtml(copy.hero, rotating));
    save(`${dir}/01-rotation.png`, await stage.screenshot());
    await stage.setContent(stageHtml(copy.pause, paused));
    save(`${dir}/03-investigate.png`, await stage.screenshot());

    if (copy.tile) {
      await stage.setViewportSize({ width: 440, height: 280 });
      await stage.setContent(`<!doctype html><meta charset="utf-8"><style>
        * { margin: 0; } body { width: 440px; height: 280px; display: grid; place-content: center; justify-items: center; gap: 6px; font-family: "Segoe UI", system-ui, sans-serif; color: #f8fafc;
          background: radial-gradient(420px 260px at 10% -10%, rgba(37,99,235,.38), transparent 65%), radial-gradient(360px 240px at 105% 110%, rgba(6,182,212,.22), transparent 60%), #0b1220; }
        img { width: 104px; height: 104px; } h1 { font-size: 40px; letter-spacing: -.8px; margin-top: 4px; } p { font-size: 18px; color: #cbd5e1; }
      </style><img src="${logoUrl}"><h1>Lepidox</h1><p>${copy.tile}</p>`);
      save(`${OUT}/promo-small-440x280.png`, await stage.screenshot());

    }

  } finally {
    await ctx?.close();
    await new Promise((resolve) => server.close(resolve));
    assert.equal(dirname(resolve(profile)), resolve(tmpdir()), "Only remove the temporary browser profile");
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}

for (const locale of Object.keys(COPY)) await forLocale(locale);
