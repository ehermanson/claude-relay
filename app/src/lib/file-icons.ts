import {
  siAstro,
  siCloudflareworkers,
  siCss,
  siDocker,
  siGo,
  siGraphql,
  siHtml5,
  siJavascript,
  siKotlin,
  siMarkdown,
  siNodedotjs,
  siPhp,
  siPnpm,
  siPrisma,
  siPython,
  siReact,
  siRuby,
  siRust,
  siSass,
  siSvelte,
  siSwift,
  siTailwindcss,
  siTypescript,
  siVuedotjs,
  siYarn,
  type SimpleIcon,
} from "simple-icons";

type Theme = "light" | "dark";
type IconAsset =
  | { kind: "simple"; icon: SimpleIcon }
  | { kind: "lucide"; paths: readonly string[] };

const FILE_ICON_STROKE = {
  dark: "#b3a8a0",
  light: "#8f857d",
} as const;

const FOLDER_ICON_STROKE = {
  dark: "#c0b3a4",
  light: "#8f857d",
} as const;

const LOW_CONTRAST_ICON_FILL = {
  dark: "#d8cec5",
  light: "#4f4741",
} as const;

const LUCIDE_ICON_STROKE = {
  dark: "#b9afa7",
  light: "#736a63",
} as const;

const IMAGE_ICON_PATHS = [
  "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  "M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
  "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
] as const;

const BRACES_ICON_PATHS = [
  "M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1",
  "M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1",
] as const;

const GIT_ICON_PATHS = [
  "M15 6a9 9 0 0 0-9 9V3",
  "M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
] as const;

const FILE_NAME_ICONS = new Map<string, IconAsset>([
  ["package.json", { kind: "simple", icon: siNodedotjs }],
  ["package-lock.json", { kind: "simple", icon: siNodedotjs }],
  ["pnpm-lock.yaml", { kind: "simple", icon: siPnpm }],
  ["yarn.lock", { kind: "simple", icon: siYarn }],
  ["dockerfile", { kind: "simple", icon: siDocker }],
  ["docker-compose.yml", { kind: "simple", icon: siDocker }],
  ["docker-compose.yaml", { kind: "simple", icon: siDocker }],
  ["wrangler.toml", { kind: "simple", icon: siCloudflareworkers }],
  ["wrangler.json", { kind: "simple", icon: siCloudflareworkers }],
  ["wrangler.jsonc", { kind: "simple", icon: siCloudflareworkers }],
  ["wrangler.yaml", { kind: "simple", icon: siCloudflareworkers }],
  ["wrangler.yml", { kind: "simple", icon: siCloudflareworkers }],
  ["tailwind.config.js", { kind: "simple", icon: siTailwindcss }],
  ["tailwind.config.cjs", { kind: "simple", icon: siTailwindcss }],
  ["tailwind.config.mjs", { kind: "simple", icon: siTailwindcss }],
  ["tailwind.config.ts", { kind: "simple", icon: siTailwindcss }],
  ["tailwind.config.cts", { kind: "simple", icon: siTailwindcss }],
  ["tailwind.config.mts", { kind: "simple", icon: siTailwindcss }],
  [".gitignore", { kind: "lucide", paths: GIT_ICON_PATHS }],
  [".gitattributes", { kind: "lucide", paths: GIT_ICON_PATHS }],
  [".gitmodules", { kind: "lucide", paths: GIT_ICON_PATHS }],
  [".gitconfig", { kind: "lucide", paths: GIT_ICON_PATHS }],
]);

const FILE_EXTENSION_ICONS = new Map<string, IconAsset>([
  ["astro", { kind: "simple", icon: siAstro }],
  ["css", { kind: "simple", icon: siCss }],
  ["scss", { kind: "simple", icon: siSass }],
  ["sass", { kind: "simple", icon: siSass }],
  ["dockerfile", { kind: "simple", icon: siDocker }],
  ["go", { kind: "simple", icon: siGo }],
  ["graphql", { kind: "simple", icon: siGraphql }],
  ["gql", { kind: "simple", icon: siGraphql }],
  ["html", { kind: "simple", icon: siHtml5 }],
  ["htm", { kind: "simple", icon: siHtml5 }],
  ["js", { kind: "simple", icon: siJavascript }],
  ["mjs", { kind: "simple", icon: siJavascript }],
  ["cjs", { kind: "simple", icon: siJavascript }],
  ["jsx", { kind: "simple", icon: siReact }],
  ["json", { kind: "lucide", paths: BRACES_ICON_PATHS }],
  ["md", { kind: "simple", icon: siMarkdown }],
  ["svg", { kind: "lucide", paths: IMAGE_ICON_PATHS }],
  ["ts", { kind: "simple", icon: siTypescript }],
  ["mts", { kind: "simple", icon: siTypescript }],
  ["cts", { kind: "simple", icon: siTypescript }],
  ["tsx", { kind: "simple", icon: siReact }],
  ["kt", { kind: "simple", icon: siKotlin }],
  ["kts", { kind: "simple", icon: siKotlin }],
  ["php", { kind: "simple", icon: siPhp }],
  ["prisma", { kind: "simple", icon: siPrisma }],
  ["py", { kind: "simple", icon: siPython }],
  ["rb", { kind: "simple", icon: siRuby }],
  ["rs", { kind: "simple", icon: siRust }],
  ["svelte", { kind: "simple", icon: siSvelte }],
  ["swift", { kind: "simple", icon: siSwift }],
  ["vue", { kind: "simple", icon: siVuedotjs }],
]);

const GENERIC_FILE_PATHS = [
  "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z",
  "M14 2v6h6",
] as const;

const GENERIC_FOLDER_PATHS = [
  "M3 7.5A2.5 2.5 0 0 1 5.5 5h4.2a2 2 0 0 1 1.4.58l1.3 1.34c.38.39.9.6 1.44.6H18.5A2.5 2.5 0 0 1 21 10v8.5A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5z",
];

function escapeSvg(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, " ")
    .replace(/%3D/g, "=")
    .replace(/%3A/g, ":")
    .replace(/%2F/g, "/");
}

function buildSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${escapeSvg(svg)}`;
}

function renderGenericIcon(paths: readonly string[], stroke: string): string {
  const pathMarkup = paths
    .map(
      (path) =>
        `<path d="${path}" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${pathMarkup}</svg>`;
}

function renderLucideIcon(paths: readonly string[], theme: Theme): string {
  const pathMarkup = paths
    .map(
      (path) =>
        `<path d="${path}" fill="none" stroke="${LUCIDE_ICON_STROKE[theme]}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${pathMarkup}</svg>`;
}

function relativeLuminance(hex: string): number {
  const normalized = hex.replace(/^#/, "");
  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const linearize = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

  const red = linearize(r);
  const green = linearize(g);
  const blue = linearize(b);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function themedIconFill(icon: SimpleIcon, theme: Theme): string {
  const luminance = relativeLuminance(icon.hex);
  if (theme === "dark" && luminance < 0.18) {
    return LOW_CONTRAST_ICON_FILL.dark;
  }
  if (theme === "light" && luminance > 0.92) {
    return LOW_CONTRAST_ICON_FILL.light;
  }
  return `#${icon.hex}`;
}

function renderSimpleIcon(icon: SimpleIcon, theme: Theme): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${themedIconFill(icon, theme)}"><path d="${icon.path}"/></svg>`;
}

function extensionCandidates(filename: string): string[] {
  const normalized = filename.toLowerCase();
  const dotIndex = normalized.indexOf(".");
  if (dotIndex <= 0) return [];

  const parts = normalized.slice(dotIndex + 1).split(".");
  const candidates: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    candidates.push(parts.slice(i).join("."));
  }
  return candidates;
}

function resolveFileIcon(filename: string): IconAsset | null {
  const lowerName = filename.toLowerCase();
  const byName = FILE_NAME_ICONS.get(lowerName);
  if (byName) return byName;

  if (lowerName === "tsconfig.json" || lowerName.startsWith("tsconfig.")) {
    return { kind: "simple", icon: siTypescript };
  }

  for (const extension of extensionCandidates(filename)) {
    const byExtension = FILE_EXTENSION_ICONS.get(extension);
    if (byExtension) return byExtension;
  }

  return null;
}

export function basenameOfPath(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, "/").replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

export function getFileIconUrl(path: string, kind: "file" | "directory", theme: Theme): string {
  if (kind === "directory") {
    return buildSvgDataUrl(renderGenericIcon(GENERIC_FOLDER_PATHS, FOLDER_ICON_STROKE[theme]));
  }

  const icon = resolveFileIcon(basenameOfPath(path));
  if (icon) {
    return buildSvgDataUrl(
      icon.kind === "simple"
        ? renderSimpleIcon(icon.icon, theme)
        : renderLucideIcon(icon.paths, theme),
    );
  }

  return buildSvgDataUrl(renderGenericIcon(GENERIC_FILE_PATHS, FILE_ICON_STROKE[theme]));
}
