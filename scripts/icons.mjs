// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

// Draws the Lepidox mark and writes every icon derived from it:
//   assets/icons/lepidox.svg                  vector master, shown in the popup and options page
//   assets/icons/lepidox[-state]-<size>.png   extension and toolbar icons
//   store/logo-300.png                        Microsoft Edge Add-ons logo
//
// A screen outline becomes a clockwise loop: dashboards in continuous rotation.
// Flat copper refers to lepidocrocite / iron oxide / Rust, the origin of the name.
// SVG and PNG share the same geometry; no fonts, gradients or dependencies.
// Usage: node scripts/icons.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

import { root } from "./validate.mjs";

// A 4-unit stroke becomes 2px at the smallest toolbar size (16px). Straight edges
// sit on even coordinates so they land on whole pixels at 16, 32 and 48px.
const GRID = 32;
const SAMPLES = 8;

const PALETTES = {
  "": "#c4623c",
  "-active": "#16a34a",
  "-paused": "#d99216",
  "-error": "#dc4545",
  "-inactive": "#7d8795"
};

// One filled outline, including the arrow. Arcs specify [radius, sweep, x, y].
// Keeping the outline as commands makes both outputs use exactly the same mark.
const OUTLINE = [
  ["M", 17, 28], ["L", 8, 28], ["A", 6, 1, 2, 22],
  ["L", 2, 10], ["A", 6, 1, 8, 4],
  ["L", 20, 4], ["A", 6, 1, 26, 10],
  ["L", 26, 14], ["L", 29, 14], ["L", 24, 21],
  ["L", 19, 14], ["L", 22, 14], ["L", 22, 10],
  ["A", 2, 0, 20, 8], ["L", 8, 8], ["A", 2, 0, 6, 10],
  ["L", 6, 22], ["A", 2, 0, 8, 24], ["L", 17, 24],
  ["A", 2, 1, 17, 28], ["Z"]
];

// Flatten the circular arcs only for rasterisation; SVG retains exact arcs.
function outlinePoints() {
  const points = [];
  for (const [command, ...args] of OUTLINE) {
    if (command === "M" || command === "L") {
      points.push(args);
    } else if (command === "A") {
      const [radius, sweep, x, y] = args;
      const [px, py] = points.at(-1);
      const dx = x - px;
      const dy = y - py;
      const length = Math.hypot(dx, dy);
      const offset = Math.sqrt(Math.max(0, radius ** 2 - length ** 2 / 4));
      const direction = sweep ? 1 : -1;
      const cx = (px + x) / 2 - direction * dy / length * offset;
      const cy = (py + y) / 2 + direction * dx / length * offset;
      const start = Math.atan2(py - cy, px - cx);
      let angle = Math.atan2(y - cy, x - cx) - start;
      if (sweep && angle <= 0) angle += Math.PI * 2;
      if (!sweep && angle >= 0) angle -= Math.PI * 2;
      const steps = Math.ceil(Math.abs(angle) * 32);
      for (let step = 1; step <= steps; step += 1) {
        const at = start + angle * step / steps;
        points.push([cx + radius * Math.cos(at), cy + radius * Math.sin(at)]);
      }
    }
  }
  return points;
}

const POINTS = outlinePoints();

const rgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

// Returns size x size RGBA pixels. `pad` keeps that many transparent pixels around the mark.
export function render(size, state = "", pad = 0) {
  const color = rgb(PALETTES[state]);
  const scale = GRID / (size - 2 * pad);
  const pixels = Buffer.alloc(size * size * 4);
  const coverage = new Uint8Array(size * size);

  // Scanline coverage keeps supersampling quick even for the 300px store logo.
  for (let row = 0; row < size * SAMPLES; row += 1) {
    const y = ((row + 0.5) / SAMPLES - pad) * scale;
    const intersections = [];
    for (let index = 0; index < POINTS.length; index += 1) {
      const [ax, ay] = POINTS[index];
      const [bx, by] = POINTS[(index + 1) % POINTS.length];
      if ((ay > y) !== (by > y)) intersections.push(ax + (y - ay) * (bx - ax) / (by - ay));
    }
    intersections.sort((a, b) => a - b);
    const offset = Math.floor(row / SAMPLES) * size;
    for (let index = 0; index < intersections.length; index += 2) {
      const start = Math.max(0, Math.ceil((intersections[index] / scale + pad) * SAMPLES - 0.5));
      const end = Math.min(size * SAMPLES, Math.ceil((intersections[index + 1] / scale + pad) * SAMPLES - 0.5));
      for (let column = start; column < end; column += 1) {
        coverage[offset + Math.floor(column / SAMPLES)] += 1;
      }
    }
  }
  for (let index = 0; index < coverage.length; index += 1) {
    if (!coverage[index]) continue;
    pixels.set(color, index * 4);
    pixels[index * 4 + 3] = Math.round(coverage[index] / (SAMPLES * SAMPLES) * 255);
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
  const path = OUTLINE.map(([command, ...args]) => command === "A"
    ? `A${args[0]} ${args[0]} 0 0 ${args[1]} ${args[2]} ${args[3]}`
    : `${command}${args.join(" ")}`).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}">
  <path fill="${PALETTES[state]}" d="${path}"/>
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
      // Reserve a 16px transparent margin around the drawing area at store size.
      const pad = size === 128 ? 16 : 0;
      writeFileSync(join(icons, `lepidox${state}-${size}.png`), encodePng(size, render(size, state, pad)));
      count += 1;
    }
  }
  writeFileSync(join(icons, "lepidox.svg"), svg());
  writeFileSync(join(root, "store/logo-300.png"), encodePng(300, render(300)));
  console.log(`${count} PNG icons, lepidox.svg and store/logo-300.png written.`);
}
