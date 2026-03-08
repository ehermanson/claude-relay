import manifestData from "./vscode-icons-manifest.json";

const VSCODE_ICONS_VERSION = "v12.17.0";
const VSCODE_ICONS_BASE_URL = `https://cdn.jsdelivr.net/gh/vscode-icons/vscode-icons@${VSCODE_ICONS_VERSION}/icons`;

type Theme = "light" | "dark";

interface IconDefinition {
  iconPath: string;
}

interface ThemeManifest {
  file: string;
  folder: string;
  folderExpanded: string;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  folderNames: Record<string, string>;
  folderNamesExpanded: Record<string, string>;
  languageIds: Record<string, string>;
}

interface VscodeIconsManifest extends ThemeManifest {
  iconDefinitions: Record<string, IconDefinition>;
  light: ThemeManifest;
}

const manifest = manifestData as VscodeIconsManifest;

function normalizeMap(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries).map(([key, value]) => [key.toLowerCase(), value]));
}

const fileNames = normalizeMap(manifest.fileNames);
const fileExtensions = normalizeMap(manifest.fileExtensions);
const folderNames = normalizeMap(manifest.folderNames);
const lightFileNames = normalizeMap(manifest.light.fileNames);
const lightFileExtensions = normalizeMap(manifest.light.fileExtensions);
const lightFolderNames = normalizeMap(manifest.light.folderNames);

function fallbackFilename(kind: "file" | "directory"): string {
  return kind === "directory" ? "default_folder.svg" : "default_file.svg";
}

function iconUrlFromDefinitionKey(iconKey: string | undefined, kind: "file" | "directory"): string {
  const iconPath = iconKey ? manifest.iconDefinitions[iconKey]?.iconPath : undefined;
  return `${VSCODE_ICONS_BASE_URL}/${iconPath || fallbackFilename(kind)}`;
}

function extensionCandidates(filename: string): string[] {
  const normalized = filename.toLowerCase();
  const dotIndex = normalized.indexOf(".");
  if (dotIndex <= 0) return [];

  const parts = normalized.slice(dotIndex + 1).split(".");
  const candidates: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    candidates.push(parts.slice(i).join("."));
  }
  return candidates;
}

export function basenameOfPath(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

function resolveFileIconKey(filename: string, theme: Theme): string | undefined {
  const lowerName = filename.toLowerCase();
  const themedNameKey = theme === "light" ? lightFileNames.get(lowerName) : undefined;
  if (themedNameKey) return themedNameKey;

  const nameKey = fileNames.get(lowerName);
  if (nameKey) return nameKey;

  for (const extension of extensionCandidates(filename)) {
    const themedExtensionKey = theme === "light" ? lightFileExtensions.get(extension) : undefined;
    if (themedExtensionKey) return themedExtensionKey;

    const extensionKey = fileExtensions.get(extension);
    if (extensionKey) return extensionKey;
  }

  return theme === "light" ? manifest.light.file || manifest.file : manifest.file;
}

function resolveFolderIconKey(folderName: string, theme: Theme): string | undefined {
  const lowerName = folderName.toLowerCase();
  const themedFolderKey = theme === "light" ? lightFolderNames.get(lowerName) : undefined;
  if (themedFolderKey) return themedFolderKey;

  const folderKey = folderNames.get(lowerName);
  if (folderKey) return folderKey;

  return theme === "light" ? manifest.light.folder || manifest.folder : manifest.folder;
}

export function getVscodeIconUrl(path: string, kind: "file" | "directory", theme: Theme): string {
  const name = basenameOfPath(path);
  const iconKey =
    kind === "directory" ? resolveFolderIconKey(name, theme) : resolveFileIconKey(name, theme);
  return iconUrlFromDefinitionKey(iconKey, kind);
}
