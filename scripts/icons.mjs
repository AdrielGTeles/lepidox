// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

// Draws the Lepidox mark and writes every icon derived from it:
//   assets/icons/lepidox.svg                  vector master, shown in the popup and options page
//   assets/icons/lepidox[-state]-<size>.png   extension and toolbar icons
//   store/logo-300.png                        Microsoft Edge Add-ons logo
//
// The mark is a butterfly (the name comes from Lepidoptera) reduced to four
// angled screens, in white on a solid badge. The badge colour is the state.
// Usage: node scripts/icons.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

import { root } from "./validate.mjs";

// Everything is drawn on a 16-unit square, so edges land on whole pixels at 16, 32 and 48.
const GRID = 16;
const BADGE_RADIUS = 3.5;
const WING_RADIUS = 0.55;
const SAMPLES = 8;

// Badge gradient per state, top-left to bottom-right.
const BADGES = {
  "": ["#2563eb", "#0891b2"],
  "-active": ["#16a34a", "#15803d"],
  "-paused": ["#d97706", "#b45309"],
  "-error": ["#ef4444", "#b91c1c"],
  "-inactive": ["#64748b", "#475569"]
};

// Clear space between the two halves, chosen so its edges fall on pixel boundaries.
const GAPS = { 16: 2, 48: 4 / 3 };
const DEFAULT_GAP = 1;

// Corners are rounded by growing each polygon by WING_RADIUS, so the points
// below sit that far inside the visible outline.
function wings(gap) {
  const inner = GRID / 2 - gap / 2 - WING_RADIUS;
  const upper = [[inner, 7.45], [inner, 6.55], [2.55, 3.55], [2.55, 7.45]];
  const lower = [[inner, 9.55], [3.55, 9.55], [4.6, 12.45], [inner, 10.45]];
  const mirrored = (points) => points.map(([x, y]) => [GRID - x, y]);
  return [upper, mirrored(upper), lower, mirrored(lower)];
}

const badge = [
  [BADGE_RADIUS, BADGE_RADIUS],
  [GRID - BADGE_RADIUS, BADGE_RADIUS],
  [GRID - BADGE_RADIUS, GRID - BADGE_RADIUS],
  [BADGE_RADIUS, GRID - BADGE_RADIUS]
];

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

// Returns size x size RGBA pixels. `pad` keeps that many transparent pixels around the badge.
export function render(size, state = "", pad = 0) {
  const [from, to] = BADGES[state].map(rgb);
  const shapes = wings(GAPS[size] ?? DEFAULT_GAP);
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
          if (!insideRounded(badge, BADGE_RADIUS, x, y)) continue;
          covered += 1;
          const white = shapes.some((points) => insideRounded(points, WING_RADIUS, x, y));
          const t = (x + y) / (2 * GRID);
          for (let channel = 0; channel < 3; channel += 1) {
            sum[channel] += white ? 255 : from[channel] + (to[channel] - from[channel]) * t;
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
  const [from, to] = BADGES[state];
  const polygons = wings(DEFAULT_GAP)
    .map((points) => `    <polygon points="${points.map(([x, y]) => `${+x.toFixed(2)},${+y.toFixed(2)}`).join(" ")}"/>`)
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}">
  <defs>
    <linearGradient id="badge" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/>
      <stop offset="1" stop-color="${to}"/>
    </linearGradient>
  </defs>
  <rect width="${GRID}" height="${GRID}" rx="${BADGE_RADIUS}" fill="url(#badge)"/>
  <g fill="#fff" stroke="#fff" stroke-width="${WING_RADIUS * 2}" stroke-linejoin="round">
${polygons}
  </g>
</svg>
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const icons = join(root, "assets/icons");
  mkdirSync(icons, { recursive: true });
  mkdirSync(join(root, "store"), { recursive: true });

  let count = 0;
  for (const state of Object.keys(BADGES)) {
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
