/**
 * Project favicon scanner.
 *
 * Pure module (no class state, no DB) so it can be unit-tested with file
 * fixtures. The flow is:
 *
 *   1. Walk the project tree breadth/depth-limited, skipping noise dirs.
 *   2. Score every plausible icon file by category + format + size.
 *   3. Score every icon declared in any `site.webmanifest` / `manifest.json`
 *      using its declared `sizes`/`purpose`. Manifest icons compete in the
 *      same pool as filesystem matches — they are NOT a fallback-only.
 *   4. Score Xcode `Assets.xcassets/*.appiconset/Contents.json` icons.
 *   5. Apply a path-aware bonus (project name / app-root segments).
 *   6. Sort with deterministic tie-breakers; return the winner's path.
 *
 * Designed to be cheap on a huge monorepo: a directory budget and an icon
 * budget cap the walk independently so noisy dirs can't starve manifest /
 * sibling checks before they happen.
 */

import { existsSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import { basename, extname, join } from "node:path";

const DEFAULT_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".cache",
  "coverage",
  "__pycache__",
  ".build", // Swift Package Manager build output
  ".vercel",
  ".svelte-kit",
  "out",
  "target", // Rust / some Java
  ".relay",
  ".agents", // skills bundled with the project; not the project icon
]);

const IMAGE_EXTS = new Set([".svg", ".png", ".webp", ".jpg", ".jpeg", ".ico"]);

const MANIFEST_NAMES = ["site.webmanifest", "manifest.webmanifest", "manifest.json"];

/**
 * Directory names worth visiting first. Order matters: when a `public/` and a
 * `junk/` dir are siblings, we recurse into `public/` first so the icon budget
 * is spent where icons actually live, not on a noisy sibling. Alphabetical
 * fallback after these.
 */
const PRIORITY_DIRS = [
  "public",
  "static",
  "assets",
  "app",
  "apps",
  "src",
  "Sources", // SwiftPM
  "Resources",
  "packages",
  "frontend",
  "web",
];

export interface FindIconOptions {
  /**
   * Names the scan should bias toward. When a file path contains any of these
   * (case-insensitive segment or filename match), the candidate is boosted.
   * Typically the project's `name` and `slug`. Falls back to the basename of
   * the project directory if omitted.
   */
  projectNames?: string[];
  /** Directory names to skip on top of the default noise list. */
  extraSkipDirs?: string[];
  /** Maximum recursion depth from the project root. Default 5. */
  maxDepth?: number;
  /**
   * Maximum number of scored icon candidates to collect before bailing out.
   * Default 500. Counts ONLY plausible icon files, not all dir entries —
   * so noisy directories don't starve sibling dirs.
   */
  maxIconCandidates?: number;
  /**
   * Hard safety cap on total file entries iterated. Default 50_000. This
   * guards against pathological trees but is generous enough that no real
   * project should hit it (`node_modules` etc. are already skipped).
   */
  maxFileEntries?: number;
}

interface ScoredCandidate {
  path: string;
  score: number;
  depth: number;
  source: "file" | "manifest" | "appiconset";
}

/**
 * Score a filename as a candidate project icon. Higher = better.
 * Returns null if the file doesn't look like an icon at all.
 *
 * The scoring is deliberately category-dominated so format/category beats
 * any size differences within reason:
 *   apple-touch (~9k)  > pwa/android-chrome (~8.5k)  > favicon (~7k)
 *   > maskable (~6.5k) > app-icon (~6k) > mstile (~5.5k) > icon (~5k)
 *   > logo (~3k, last resort)
 * SVG adds +2500 (scales perfectly); .ico subtracts 500 (legacy).
 * Raster size in the filename (`-512`, `-192x192`, `-180`) is added,
 * capped at 1024.
 *
 * Exported for tests.
 */
export function scoreIconCandidate(name: string): number | null {
  const lower = name.toLowerCase();
  const ext = extname(lower);
  if (!IMAGE_EXTS.has(ext)) return null;
  const stem = lower.slice(0, lower.length - ext.length);

  const isAppleTouch = /apple[-_]?(touch[-_]?)?icon/.test(stem);
  const isAndroidChrome = /android[-_]?chrome/.test(stem);
  const isPwa = /(^|[-_.])pwa[-_]/.test(stem);
  const isMaskable = /maskable/.test(stem);
  const isFavicon = /(^|[-_.])favicon(\b|[-_.\d]|$)/.test(stem);
  const isAppIcon = /(^|[-_.])app[-_.]?icon/.test(stem);
  const isMstile = /mstile/.test(stem);
  const isIcon = stem === "icon" || /(^|[-_.])icon(\b|[-_.\d]|$)/.test(stem);
  const isLogo = stem === "logo" || /(^|[-_.])logo(\b|[-_.\d]|$)/.test(stem);

  if (
    !isAppleTouch &&
    !isAndroidChrome &&
    !isPwa &&
    !isMaskable &&
    !isFavicon &&
    !isAppIcon &&
    !isMstile &&
    !isIcon &&
    !isLogo
  ) {
    return null;
  }

  // Explicit reject: opengraph-image / twitter-image (Next.js conventions).
  if (/opengraph|twitter[-_]image/.test(stem)) return null;

  let base = 0;
  if (isAppleTouch) base = 9000;
  else if (isAndroidChrome || isPwa) base = 8500;
  else if (isFavicon) base = 7000;
  else if (isMaskable) base = 6500;
  else if (isAppIcon) base = 6000;
  else if (isMstile) base = 5500;
  else if (isIcon) base = 5000;
  else if (isLogo) base = 3000;

  if (ext === ".svg") base += 2500;
  else if (ext === ".ico") base -= 500;

  if (ext !== ".svg") {
    const sizeMatch = stem.match(/(\d{2,4})(?:x\d{2,4})?(?:[-_.]|$)/);
    if (sizeMatch && sizeMatch[1]) {
      base += Math.min(parseInt(sizeMatch[1], 10), 1024);
    }
  }

  return base;
}

/**
 * Parse a single web manifest file and return scored candidates for each
 * icon entry that exists on disk. Exported for tests.
 *
 * Score band: declared icons are authoritative for the app author, so they
 * sit near the apple-touch tier (8500 base) with the same size bonus as
 * filesystem candidates. Maskable-only entries drop to 7500 because they
 * are designed to be cropped and look bad rendered raw.
 */
export function readManifestCandidates(
  manifestPath: string,
): Array<{ path: string; score: number }> {
  const out: Array<{ path: string; score: number }> = [];
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    return out;
  }
  const icons = (manifest as { icons?: unknown })?.icons;
  const baseDir = manifestPath.slice(0, manifestPath.lastIndexOf("/"));

  type Raw = { src: string; size: number; purpose?: string };
  const raw: Raw[] = [];

  if (Array.isArray(icons)) {
    for (const icon of icons) {
      if (icon && typeof icon === "object" && typeof (icon as { src?: unknown }).src === "string") {
        const sizesField = String((icon as { sizes?: unknown }).sizes ?? "");
        // `sizes` can be space-separated ("48x48 96x96 192x192"); take the largest.
        const sizes = sizesField
          .split(/\s+/)
          .map((s) => parseInt(s.split("x")[0] ?? "", 10))
          .filter((n) => Number.isFinite(n) && n > 0);
        const size = sizes.length > 0 ? Math.max(...sizes) : 0;
        raw.push({
          src: (icon as { src: string }).src,
          size,
          purpose:
            typeof (icon as { purpose?: unknown }).purpose === "string"
              ? (icon as { purpose: string }).purpose
              : undefined,
        });
      }
    }
  } else if (icons && typeof icons === "object") {
    // Browser-extension shape: { "48": "icon48.png" }
    for (const [key, val] of Object.entries(icons as Record<string, unknown>)) {
      if (typeof val === "string") {
        raw.push({ src: val, size: parseInt(key, 10) || 0 });
      }
    }
  }

  for (const { src, size, purpose } of raw) {
    if (src.startsWith("http://") || src.startsWith("https://")) continue;
    const fullPath = join(baseDir, src.replace(/^\.?\//, ""));
    if (!existsSync(fullPath)) continue;
    // `purpose` may be space-separated ("any maskable"). Maskable-only loses.
    const purposes = (purpose ?? "any").toLowerCase().split(/\s+/).filter(Boolean);
    const maskableOnly = purposes.length > 0 && purposes.every((p) => p === "maskable");
    let score = maskableOnly ? 7500 : 8500;
    score += Math.min(size, 1024);
    out.push({ path: fullPath, score });
  }

  return out;
}

/**
 * Read an Xcode `AppIcon.appiconset` directory and return the first icon
 * file referenced in `Contents.json` that exists on disk. Exported for tests.
 */
export function readAppIconSet(appIconSetDir: string): string | null {
  const contentsPath = join(appIconSetDir, "Contents.json");
  if (!existsSync(contentsPath)) return null;
  let contents: unknown;
  try {
    contents = JSON.parse(readFileSync(contentsPath, "utf-8"));
  } catch {
    return null;
  }
  const images = (contents as { images?: unknown })?.images;
  if (!Array.isArray(images)) return null;
  for (const img of images) {
    const filename =
      img && typeof img === "object" ? (img as { filename?: unknown }).filename : undefined;
    if (typeof filename === "string" && filename.length > 0) {
      const fullPath = join(appIconSetDir, filename);
      if (existsSync(fullPath)) return fullPath;
    }
  }
  return null;
}

/**
 * Bonus for paths that look like the right app within a monorepo. Tie-breaker
 * material — small enough that it never overrides the category-level signal,
 * but enough to disambiguate two equally-good icons in different apps.
 *
 *   +120 — path segment exactly equals a project name/slug
 *   +60  — path segment starts with a project name/slug
 *   +80  — filename contains a project name/slug
 *   +40  — path contains a conventional app-asset segment
 *           (public/static/assets/src/app/app/resources)
 */
function pathBias(path: string, projectNames: string[]): number {
  const lowerPath = path.toLowerCase();
  const segments = lowerPath.split("/");
  const filename = basename(lowerPath);
  let bonus = 0;
  for (const rawName of projectNames) {
    const name = rawName.toLowerCase();
    if (!name) continue;
    if (segments.some((seg) => seg === name)) bonus += 120;
    else if (segments.some((seg) => seg.startsWith(name))) bonus += 60;
    if (filename.includes(name)) bonus += 80;
  }
  const APP_ROOT_HINTS = ["/public/", "/static/", "/assets/", "/src/app/", "/app/", "/resources/"];
  if (APP_ROOT_HINTS.some((h) => lowerPath.includes(h))) bonus += 40;
  return bonus;
}

/**
 * Walk a project tree and return the absolute path of the best icon found,
 * or `null` if none. Pure (no class state) so it's directly testable.
 */
export function findProjectIcon(dir: string, opts: FindIconOptions = {}): string | null {
  if (!existsSync(join(dir, ".git"))) return null;

  const skipDirs = new Set([...DEFAULT_SKIP_DIRS, ...(opts.extraSkipDirs ?? [])]);
  const maxDepth = opts.maxDepth ?? 5;
  const maxIconCandidates = opts.maxIconCandidates ?? 500;
  const maxFileEntries = opts.maxFileEntries ?? 50_000;

  const candidates: ScoredCandidate[] = [];
  let fileEntriesScanned = 0;

  const tooMany = () =>
    candidates.length >= maxIconCandidates || fileEntriesScanned >= maxFileEntries;

  const walk = (base: string, depth: number): void => {
    if (depth > maxDepth || tooMany()) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(base, { withFileTypes: true });
    } catch {
      return;
    }

    // 1. Manifest icons FIRST — cheap (one extra file open) and authoritative.
    // Doing this before the file scan means a noisy directory full of
    // non-icon files can't starve the manifest check via the icon budget.
    for (const manifestName of MANIFEST_NAMES) {
      const manifestPath = join(base, manifestName);
      if (!existsSync(manifestPath)) continue;
      for (const mc of readManifestCandidates(manifestPath)) {
        candidates.push({ path: mc.path, score: mc.score, depth, source: "manifest" });
        if (candidates.length >= maxIconCandidates) return;
      }
    }

    // 2. Score every file in this dir.
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      fileEntriesScanned++;
      if (fileEntriesScanned >= maxFileEntries) return;
      const score = scoreIconCandidate(entry.name);
      if (score === null) continue;
      candidates.push({ path: join(base, entry.name), score, depth, source: "file" });
      if (candidates.length >= maxIconCandidates) return;
    }

    // 3. Recurse, but visit priority directories first. This guarantees
    //    `public/`, `static/`, `assets/`, `Sources/`, … get scanned before a
    //    noisy sibling can starve the icon budget.
    const dirs = entries.filter(
      (e) => e.isDirectory() && !e.name.startsWith(".") && !skipDirs.has(e.name),
    );
    const priorityIndex = (name: string): number => {
      const i = PRIORITY_DIRS.indexOf(name);
      return i === -1 ? PRIORITY_DIRS.length : i;
    };
    dirs.sort((a, b) => {
      const pa = priorityIndex(a.name);
      const pb = priorityIndex(b.name);
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    });
    for (const entry of dirs) {
      const childPath = join(base, entry.name);
      if (entry.name.endsWith(".appiconset")) {
        const xc = readAppIconSet(childPath);
        // Treat as a strong app-icon signal — between favicon and apple-touch.
        if (xc) candidates.push({ path: xc, score: 7500, depth: depth + 1, source: "appiconset" });
        continue;
      }
      walk(childPath, depth + 1);
      if (tooMany()) return;
    }
  };

  walk(dir, 0);

  if (candidates.length === 0) return null;

  // Project-name hints for path bias. Always include the dir basename so the
  // scanner does something sensible even when nothing else is supplied.
  const projectNames = Array.from(
    new Set([...(opts.projectNames ?? []), basename(dir)].map((s) => s.trim()).filter(Boolean)),
  );

  const ranked = candidates
    .map((c) => ({ ...c, finalScore: c.score + pathBias(c.path, projectNames) }))
    .sort((a, b) => {
      if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
      // Deterministic tie-breakers:
      // shallower wins → shorter path wins → lexicographic.
      if (a.depth !== b.depth) return a.depth - b.depth;
      if (a.path.length !== b.path.length) return a.path.length - b.path.length;
      return a.path.localeCompare(b.path);
    });

  return ranked[0]?.path ?? null;
}
