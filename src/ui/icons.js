// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

const SVG_NS = "http://www.w3.org/2000/svg";

// 24x24 viewBox. `filled` icons are solid shapes; the rest are 2px strokes.
const ICONS = {
  play: { filled: true, paths: ["M7 4.5v15l12-7.5z"] },
  pause: { filled: true, paths: ["M6 5h4v14H6z", "M14 5h4v14h-4z"] },
  stop: { filled: true, paths: ["M6 6h12v12H6z"] },
  next: { filled: true, paths: ["M5 5v14l10-7z", "M17 5h2.5v14H17z"] },
  previous: { filled: true, paths: ["M19 5v14L9 12z", "M4.5 5H7v14H4.5z"] },
  plus: { paths: ["M12 5v14", "M5 12h14"] },
  close: { paths: ["M6 6l12 12", "M18 6L6 18"] },
  check: { paths: ["M5 12.5l4.5 4.5L19 7.5"] },
  trash: { paths: ["M4 7h16", "M9 7V4h6v3", "M6.5 7l1 13h9l1-13"] },
  copy: { paths: ["M9 9h11v11H9z", "M5 15H4V4h11v1"] },
  download: { paths: ["M12 4v11", "M7.5 10.5L12 15l4.5-4.5", "M5 20h14"] },
  upload: { paths: ["M12 15V4", "M7.5 8.5L12 4l4.5 4.5", "M5 20h14"] },
  tabs: { paths: ["M3 8h18v12H3z", "M3 8V5h7l2 3"] },
  shield: { paths: ["M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z", "M9 12l2 2 4-4"] },
  grip: { filled: true, paths: ["M9 5.5a1.5 1.5 0 1 1 0 .01z", "M15 5.5a1.5 1.5 0 1 1 0 .01z", "M9 12a1.5 1.5 0 1 1 0 .01z", "M15 12a1.5 1.5 0 1 1 0 .01z", "M9 18.5a1.5 1.5 0 1 1 0 .01z", "M15 18.5a1.5 1.5 0 1 1 0 .01z"] }
};

export function icon(name) {
  const { filled = false, paths } = ICONS[name];
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  if (filled) svg.classList.add("filled");
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
