// Copyright (c) 2026 Adriel Teles
// SPDX-License-Identifier: MPL-2.0

// Builds the package uploaded to the Chrome Web Store and to Microsoft Edge
// Add-ons (both take the same zip): dist/lepidox-<version>.zip
// Usage: node scripts/build.mjs

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

import { root, validate, walk } from "./validate.mjs";

// Only what the extension needs at runtime goes in; docs, tests and tooling stay out.
const INCLUDED = ["manifest.json", "LICENSE", "NOTICE", "_locales", "assets/icons", "src"];

// A fixed timestamp keeps the zip byte-identical for the same sources.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 file names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);

    chunks.push(local, nameBytes, compressed);
    central.push(header, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}

const { errors, warnings, manifest } = validate();
warnings.forEach((warning) => console.warn(`warning: ${warning}`));
if (errors.length) {
  errors.forEach((error) => console.error(`error: ${error}`));
  process.exit(1);
}

const files = INCLUDED
  .flatMap((path) => (path.includes(".") || path === "LICENSE" || path === "NOTICE" ? [path] : walk(path)))
  .sort();
const archive = zip(files.map((name) => ({ name, data: readFileSync(join(root, name)) })));

mkdirSync(join(root, "dist"), { recursive: true });
const output = `dist/lepidox-${manifest.version}.zip`;
writeFileSync(join(root, output), archive);
console.log(`${output}: ${files.length} files, ${(archive.length / 1024).toFixed(1)} KB`);
