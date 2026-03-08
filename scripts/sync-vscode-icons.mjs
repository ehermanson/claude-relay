#!/usr/bin/env node

/**
 * Downloads the vscode-icons v12.17.0 VSIX, extracts the icon theme manifest,
 * and writes a processed JSON file for the UI.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VSIX_URL =
  "https://github.com/vscode-icons/vscode-icons/releases/download/v12.17.0/vscode-icons-12.17.0.vsix";
const VSIX_THEME_PATH = "extension/dist/src/vsicons-icon-theme.json";

const OUTPUT_PATH = new URL("../ui/src/lib/vscode-icons-manifest.json", import.meta.url);

async function main() {
  console.log("Fetching vscode-icons VSIX...");
  const res = await fetch(VSIX_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch VSIX: ${res.status} ${res.statusText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const tempDir = mkdtempSync(join(tmpdir(), "vscode-icons-"));
  const vsixPath = join(tempDir, "vscode-icons.vsix");
  writeFileSync(vsixPath, buffer);

  const raw = JSON.parse(
    execFileSync("unzip", ["-p", vsixPath, VSIX_THEME_PATH], { encoding: "utf8" }),
  );

  // Extract just the SVG filename from iconPath (e.g. "../../icons/file_type_js.svg" -> "file_type_js.svg")
  function extractIconFilename(iconPath) {
    if (!iconPath) return "";
    const idx = iconPath.lastIndexOf("/");
    return idx >= 0 ? iconPath.slice(idx + 1) : iconPath;
  }

  // Process iconDefinitions: keep only the SVG filename
  const iconDefinitions = {};
  for (const [key, def] of Object.entries(raw.iconDefinitions || {})) {
    iconDefinitions[key] = { iconPath: extractIconFilename(def.iconPath) };
  }

  // Extract simple string mappings
  const pick = (obj) => (obj ? { ...obj } : {});

  const manifest = {
    iconDefinitions,
    file: raw.file || "",
    folder: raw.folder || "",
    folderExpanded: raw.folderExpanded || "",
    fileNames: pick(raw.fileNames),
    fileExtensions: pick(raw.fileExtensions),
    folderNames: pick(raw.folderNames),
    folderNamesExpanded: pick(raw.folderNamesExpanded),
    languageIds: pick(raw.languageIds),
    light: {
      file: raw.light?.file || "",
      folder: raw.light?.folder || "",
      folderExpanded: raw.light?.folderExpanded || "",
      fileNames: pick(raw.light?.fileNames),
      fileExtensions: pick(raw.light?.fileExtensions),
      folderNames: pick(raw.light?.folderNames),
      folderNamesExpanded: pick(raw.light?.folderNamesExpanded),
      languageIds: pick(raw.light?.languageIds),
    },
  };

  const outPath = fileURLToPath(OUTPUT_PATH);

  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote ${outPath}`);

  rmSync(tempDir, { recursive: true, force: true });

  // Stats
  const defCount = Object.keys(iconDefinitions).length;
  const fnCount = Object.keys(manifest.fileNames).length;
  const feCount = Object.keys(manifest.fileExtensions).length;
  const fdCount = Object.keys(manifest.folderNames).length;
  console.log(
    `  ${defCount} icon definitions, ${fnCount} file names, ${feCount} file extensions, ${fdCount} folder names`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
