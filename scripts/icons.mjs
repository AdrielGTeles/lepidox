// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

// Draws the Lepidox mark and writes every icon derived from it:
//   assets/icons/lepidox.svg                  vector master, shown in the popup and options page
//   assets/icons/lepidox[-state]-<size>.png   extension and toolbar icons
//   store/logo-300.png                        Microsoft Edge Add-ons logo
//
// Lepidox is named after lepidocrocite, the iron oxide-hydroxide found in rust,
// which crystallises in thin plates. The mark is three plates in a spiral, each
// turned one step further than the one below: steel, rust, then the plate on display.
// Usage: node scripts/icons.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

import { root } from "./validate.mjs";

// Drawn on a 16-unit square so the top plate lands on whole pixels at 16, 32 and 48.
const GRID = 16;
const SAMPLES = 8;

// One turn step is a 1:3 slope (18.43 degrees); two steps make a 3:4 slope.
const STEP = Math.atan(1 / 3);

// Bottom to top: [side, steps turned back from the top plate, corner radius].
const PLATES = [
  [11.4, 2, 2.1],
  [10, 1, 1.9],
  [8, 0, 1.6]
];

// Per state, bottom to top: each plate's gradient from its top-left to its bottom-right.
const STEEL = ["#7b8ba1", "#5b6b82"];
const PALETTES = {
  "": [STEEL, ["#b7410e", "#8f2f0a"], ["#fb923c", "#ea580c"]],
  "-active": [STEEL, ["#15803d", "#14532d"], ["#4ade80", "#16a34a"]],
  "-paused": [STEEL, ["#b45309", "#78350f"], ["#fcd34d", "#f59e0b"]],
  "-error": [STEEL, ["#b91c1c", "#7f1d1d"], ["#f87171", "#dc2626"]],
  "-inactive": [["#475569", "#334155"], STEEL, ["#e2e8f0", "#a8b5c6"]]
};

// Corners are rounded by growing each square by its radius, so the points
// returned here sit that far inside the visible outline.
function plates(state) {
  return PLATES.map(([side, steps, radius], index) => {
    const half = side / 2 - radius;
    const angle = -steps * STEP;
    const points = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([x, y]) => [
      GRID / 2 + x * Math.cos(angle) - y * Math.sin(angle),
      GRID / 2 + x * Math.sin(angle) + y * Math.cos(angle)
    ]);
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return {
      points,
      radius,
      colors: PALETTES[state][index],
      box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    };
  });
}

// True when (x, y) is inside the convex polygon or within `radius` of its outline.
function insideRounded(points, radius, x, y) {
  let side = 0;
  let within = true;
  let nearest = Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const [ax, ay] = points[index];
    const [bx, by] = points[(index + 1) % points.length];
    const cross = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
    if (cross !== 0) {
      if (side === 0) side = cross;
      else if (cross !== side) within = false;
    }
    const along = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2);
    const t = Math.max(0, Math.min(1, along));
    nearest = Math.min(nearest, (x - ax - t * (bx - ax)) ** 2 + (y - ay - t * (by - ay)) ** 2);
  }
  return within || nearest <= radius * radius;
}

const rgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

// Returns size x size RGBA pixels. `pad` keeps that many transparent pixels around the mark.
export function render(size, state = "", pad = 0) {
  const layers = plates(state)
    .map(({ colors, ...plate }) => ({ ...plate, from: rgb(colors[0]), to: rgb(colors[1]) }))
    .reverse(); // topmost first: the first plate hit is the one seen
  const scale = GRID / (size - 2 * pad);
  const pixels = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const sum = [0, 0, 0];
      let covered = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px + (sx + 0.5) / SAMPLES - pad) * scale;
          const y = (py + (sy + 0.5) / SAMPLES - pad) * scale;
          const plate = layers.find(({ points, radius }) => insideRounded(points, radius, x, y));
          if (!plate) continue;
          covered += 1;
          const [x0, y0, x1, y1] = plate.box;
          const t = Math.max(0, Math.min(1, ((x - x0) / (x1 - x0) + (y - y0) / (y1 - y0)) / 2));
          for (let channel = 0; channel < 3; channel += 1) {
            sum[channel] += plate.from[channel] + (plate.to[channel] - plate.from[channel]) * t;
          }
        }
      }
      if (!covered) continue;
      const at = (py * size + px) * 4;
      for (let channel = 0; channel < 3; channel += 1) pixels[at + channel] = Math.round(sum[channel] / covered);
      pixels[at + 3] = Math.round((covered / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return pixels;
}

export function encodePng(size, pixels) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

export function svg(state = "") {
  const number = (value) => +value.toFixed(3);
  const names = ["bottom", "middle", "top"];
  const layers = plates(state);
  const gradients = layers.map(({ colors: [from, to] }, index) => `    <linearGradient id="${names[index]}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/>
      <stop offset="1" stop-color="${to}"/>
    </linearGradient>`);
  const polygons = layers.map(({ points, radius }, index) => {
    const list = points.map(([x, y]) => `${number(x)},${number(y)}`).join(" ");
    const paint = `url(#${names[index]})`;
    return `  <polygon points="${list}" fill="${paint}" stroke="${paint}" stroke-width="${radius * 2}" stroke-linejoin="round"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}">
  <defs>
${gradients.join("\n")}
  </defs>
${polygons.join("\n")}
</svg>
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const icons = join(root, "assets/icons");
  mkdirSync(icons, { recursive: true });
  mkdirSync(join(root, "store"), { recursive: true });

  let count = 0;
  for (const state of Object.keys(PALETTES)) {
    for (const size of [16, 32, 48, 128]) {
      // The store asks for 96px of artwork inside the 128px icon.
      const pad = size === 128 ? 16 : 0;
      writeFileSync(join(icons, `lepidox${state}-${size}.png`), encodePng(size, render(size, state, pad)));
      count += 1;
    }
  }
  writeFileSync(join(icons, "lepidox.svg"), svg());
  writeFileSync(join(root, "store/logo-300.png"), encodePng(300, render(300)));
  console.log(`${count} PNG icons, lepidox.svg and store/logo-300.png written.`);
}
