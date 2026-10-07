// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

// Checks what the stores and the browser would otherwise reject at upload or at
// runtime: manifest limits, missing files, locale gaps and remote/dynamic code.
// Usage: node scripts/validate.mjs

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const NAME_LIMIT = 75;
const DESCRIPTION_LIMIT = 132;

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

export function walk(directory) {
  return readdirSync(join(root, directory)).flatMap((name) => {
    const path = `${directory}/${name}`;
    return statSync(join(root, path)).isDirectory() ? walk(path) : [path];
  });
}

export function validate() {
  const errors = [];
  const warnings = [];
  const manifest = readJson("manifest.json");
  const sources = walk("src");
  const text = Object.fromEntries(sources.map((path) => [path, readFileSync(join(root, path), "utf8")]));

  // Manifest
  if (manifest.manifest_version !== 3) errors.push("manifest_version must be 3.");
  if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? "")) errors.push(`Invalid version "${manifest.version}".`);
  const packageVersion = readJson("package.json").version;
  if (packageVersion !== manifest.version) {
    errors.push(`package.json version (${packageVersion}) differs from manifest version (${manifest.version}).`);
  }

  for (const path of [manifest.background?.service_worker, manifest.action?.default_popup, manifest.options_ui?.page]) {
    if (!path || !existsSync(join(root, path))) errors.push(`Manifest references a missing file: ${path}`);
  }

  // Icons: the ones the manifest declares, plus the toolbar states the worker switches between.
  const icons = [...Object.entries(manifest.icons ?? {}), ...Object.entries(manifest.action?.default_icon ?? {})];
  for (const state of ["active", "paused", "error", "inactive"]) {
    for (const size of [16, 32, 48, 128]) icons.push([String(size), `assets/icons/lepidox-${state}-${size}.png`]);
  }
  for (const [size, path] of icons) {
    if (!existsSync(join(root, path))) {
      errors.push(`Missing icon: ${path}`);
      continue;
    }
    const header = readFileSync(join(root, path));
    const [width, height] = [header.readUInt32BE(16), header.readUInt32BE(20)];
    if (width !== Number(size) || height !== Number(size)) {
      errors.push(`${path} is ${width}x${height}, expected ${size}x${size}.`);
    }
  }
  if (Object.keys(manifest.commands ?? {}).filter((name) => manifest.commands[name].suggested_key).length > 4) {
    errors.push("Chrome accepts at most 4 suggested keyboard shortcuts.");
  }

  // Locales
  const locales = readdirSync(join(root, "_locales"));
  const messages = Object.fromEntries(locales.map((locale) => [locale, readJson(`_locales/${locale}/messages.json`)]));
  const reference = messages[manifest.default_locale];
  if (!reference) errors.push(`default_locale "${manifest.default_locale}" has no messages.json.`);
  const keys = Object.keys(reference ?? {});

  for (const [locale, entries] of Object.entries(messages)) {
    for (const key of keys) if (!entries[key]?.message) errors.push(`[${locale}] missing message "${key}".`);
    for (const key of Object.keys(entries)) if (!reference?.[key]) errors.push(`[${locale}] unknown message "${key}".`);
    const name = entries.extName?.message ?? "";
    const description = entries.extDescription?.message ?? "";
    if (name.length > NAME_LIMIT) errors.push(`[${locale}] name has ${name.length} characters (limit ${NAME_LIMIT}).`);
    if (description.length > DESCRIPTION_LIMIT) {
      errors.push(`[${locale}] description has ${description.length} characters (limit ${DESCRIPTION_LIMIT}).`);
    }
  }

  // Message keys used by the code
  const used = new Set();
  const collect = (source, pattern) => {
    for (const match of source.matchAll(pattern)) used.add(match[1]);
  };
  collect(JSON.stringify(manifest), /__MSG_(\w+)__/g);
  for (const [path, source] of Object.entries(text)) {
    if (path.endsWith(".html")) {
      collect(source, /data-i18n="(\w+)"/g);
      for (const match of source.matchAll(/data-i18n-attr="([^"]+)"/g)) {
        for (const pair of match[1].split(",")) used.add(pair.split(":")[1].trim());
      }
    }
    if (path.endsWith(".js")) {
      collect(source, /\bt\(\s*"(\w+)"/g);
      for (const match of source.matchAll(/\bplural\([^,]+,\s*"(\w+)",\s*"(\w+)"/g)) {
        used.add(match[1]);
        used.add(match[2]);
      }
    }
  }
  for (const key of used) if (!keys.includes(key)) errors.push(`Message "${key}" is used but not defined.`);

  // Keys picked at runtime (t(condition ? "a" : "b")) only show up as plain string literals.
  const allJs = Object.entries(text).filter(([path]) => path.endsWith(".js")).map(([, source]) => source).join("\n");
  for (const key of keys) {
    if (!used.has(key) && !allJs.includes(`"${key}"`)) warnings.push(`Message "${key}" is not used anywhere.`);
  }

  // Code the stores reject or that the extension CSP blocks
  const forbidden = [
    [/\beval\s*\(/, "eval()"],
    [/\bnew Function\s*\(/, "new Function()"],
    [/\.innerHTML\s*=/, "innerHTML assignment"],
    [/<script[^>]+src="https?:/, "remote <script>"],
    [/\bimport\s*\(\s*["']https?:/, "remote import()"]
  ];
  for (const [path, source] of Object.entries(text)) {
    for (const [pattern, label] of forbidden) {
      if (pattern.test(source)) errors.push(`${path}: ${label} is not allowed.`);
    }
    if (path.endsWith(".html") && /<script(?![^>]*\bsrc=)/.test(source)) errors.push(`${path}: inline <script> is blocked by the extension CSP.`);
    if (path.endsWith(".html") && /\son\w+="/.test(source)) errors.push(`${path}: inline event handlers are blocked by the extension CSP.`);

    if (!path.endsWith(".js")) continue;
    for (const match of source.matchAll(/from\s+"(\.[^"]+)"/g)) {
      const target = resolve(root, dirname(path), match[1]);
      if (!existsSync(target)) errors.push(`${path}: import not found: ${relative(root, target)}`);
    }
  }

  return { errors, warnings, manifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, warnings, manifest } = validate();
  warnings.forEach((warning) => console.warn(`warning: ${warning}`));
  errors.forEach((error) => console.error(`error: ${error}`));
  if (errors.length) process.exit(1);
  console.log(`Lepidox ${manifest.version}: manifest, locales and sources are valid.`);
}
