/**
 * Provider Version Probe
 *
 * Detects whether a provider's installed CLI (claude, codex) is behind the
 * latest published version. Used by provider-registry.ts to populate the
 * `versionAdvisory` field on ProviderCapabilities. The UI consumes that field
 * to fire a launch toast + render a settings card.
 *
 * Architecture:
 * - Pure helpers (`classifyInstallMethod`, `buildUpdateCommand`,
 *   `compareSemver`) live here for unit testing.
 * - I/O helpers (`getInstalledVersion`, `fetchNpmLatest`) fail soft — they
 *   never throw to callers; on error they return `null` and leave the
 *   advisory in `status: "unknown"` so the UI shows nothing.
 * - The npm registry response is cached in-memory for 1h to avoid hammering
 *   registry.npmjs.org on every refresh cycle.
 *
 * No external deps — pure Node built-ins so the module can sit in core.
 */
import { execFile, type ExecFileException } from "node:child_process";
import { realpathSync } from "node:fs";
import type { ProviderInstallMethod, ProviderKind, ProviderVersionAdvisory } from "#core/types.js";

// ─── Per-provider metadata table ────────────────────────────────────────────

export interface ProviderPackageMetadata {
  /** npm package name */
  npmPackageName: string;
  /** Homebrew formula name (if installable via brew) */
  homebrewFormula: string | null;
  /** If the binary supports `<bin> update` as a native self-update */
  nativeUpdate: { command: string; matches: (realpath: string) => boolean } | null;
}

const CLAUDE_NPM_PACKAGE = "@anthropic-ai/claude-code";
const CODEX_NPM_PACKAGE = "@openai/codex";

export const PROVIDER_PACKAGE_METADATA: Partial<Record<ProviderKind, ProviderPackageMetadata>> = {
  claude: {
    npmPackageName: CLAUDE_NPM_PACKAGE,
    homebrewFormula: "claude-code",
    nativeUpdate: {
      command: "claude update",
      matches: (realpath) => {
        const n = normalizeCommandPath(realpath);
        return n.endsWith("/.local/bin/claude") || n.includes("/.local/share/claude/");
      },
    },
  },
  codex: {
    npmPackageName: CODEX_NPM_PACKAGE,
    // Codex isn't (yet) in homebrew core; left null so install method falls back to "manual"
    homebrewFormula: null,
    nativeUpdate: null,
  },
};

// ─── Pure helpers ───────────────────────────────────────────────────────────

export function normalizeCommandPath(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}

interface ParsedVersion {
  parts: number[];
  /**
   * Pre-release identifiers split on `.`, e.g. `["beta", "2"]`. Empty array
   * means a stable release. Build metadata (after `+`) is ignored per semver.
   */
  prerelease: string[];
}

/**
 * Compare two semver-ish strings. Returns -1 if a<b, 0 if equal, 1 if a>b.
 *
 * Behavior:
 * - Strips a leading "v" (case-insensitive)
 * - Compares the numeric MAJOR.MINOR.PATCH triple first; non-numeric segments
 *   are treated as 0 for the main triple, but at least one segment must be a
 *   real number or the input is rejected
 * - Per semver, a version WITH a prerelease ranks BELOW the same version
 *   WITHOUT one (e.g. `1.2.3-beta` < `1.2.3`)
 * - When both have prereleases, prerelease identifiers are compared
 *   left-to-right: numeric identifiers compare numerically; alphanumeric
 *   identifiers compare ASCII; numeric ranks below alphanumeric; a shorter
 *   prerelease list with all prior identifiers equal ranks below a longer one
 * - Build metadata (after `+`) is ignored
 * - Returns 0 for unparseable input on either side — the caller treats that
 *   as "no advisory" so the UI stays in `status: "unknown"`
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const parse = (raw: string): ParsedVersion | null => {
    const trimmed = raw.trim().replace(/^v/i, "");
    if (!trimmed) return null;
    // Strip build metadata (after `+`) entirely — semver says it doesn't
    // affect precedence — then split the prerelease (after `-`) from the
    // main triple.
    const withoutBuild = trimmed.split("+", 1)[0];
    const dashIdx = withoutBuild.indexOf("-");
    const main = dashIdx >= 0 ? withoutBuild.slice(0, dashIdx) : withoutBuild;
    const prerelease = dashIdx >= 0 ? withoutBuild.slice(dashIdx + 1).split(".") : [];
    if (!main) return null;
    let sawNumber = false;
    const parts = main.split(".").map((p) => {
      const n = parseInt(p, 10);
      if (Number.isFinite(n)) {
        sawNumber = true;
        return n;
      }
      return 0;
    });
    if (!sawNumber) return null;
    while (parts.length < 3) parts.push(0);
    return { parts, prerelease };
  };

  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return 0;

  // Compare numeric triple first.
  const len = Math.max(pa.parts.length, pb.parts.length);
  for (let i = 0; i < len; i++) {
    const av = pa.parts[i] ?? 0;
    const bv = pb.parts[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }

  // Triple is equal: a stable release outranks any prerelease.
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1; // a is stable, b is prerelease → a > b
  if (pb.prerelease.length === 0) return -1; // a is prerelease, b is stable → a < b

  // Both have prereleases: compare identifiers left-to-right.
  return comparePrereleaseIdentifiers(pa.prerelease, pb.prerelease);
}

function comparePrereleaseIdentifiers(a: string[], b: string[]): -1 | 0 | 1 {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const cmp = compareSinglePrereleaseIdentifier(a[i], b[i]);
    if (cmp !== 0) return cmp;
  }
  // All shared identifiers equal: shorter list ranks lower (e.g. 1.0.0-alpha < 1.0.0-alpha.1)
  if (a.length < b.length) return -1;
  if (a.length > b.length) return 1;
  return 0;
}

function compareSinglePrereleaseIdentifier(a: string, b: string): -1 | 0 | 1 {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) {
    const av = parseInt(a, 10);
    const bv = parseInt(b, 10);
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  }
  // Numeric identifiers rank below alphanumeric ones.
  if (aNum) return -1;
  if (bNum) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Classify how a binary was installed based on its realpath. Mirrors the
 * patterns used by mainstream package managers on macOS and Linux. Returns
 * "manual" when we can't confidently classify — the UI then shows the package
 * name + recommended npm command but labels it as the recommended install
 * method, not a detected one.
 *
 * Pure: takes a path string, returns a label. Does no I/O.
 */
export function classifyInstallMethod(
  realpath: string,
  metadata?: ProviderPackageMetadata,
): ProviderInstallMethod {
  const n = normalizeCommandPath(realpath);

  // Provider-specific native update (e.g. `claude update` for the native binary)
  if (metadata?.nativeUpdate?.matches(realpath)) return "native";

  // Bun global
  if (n.includes("/.bun/bin/")) return "bun";

  // pnpm global locations across platforms
  if (
    n.includes("/.local/share/pnpm/") ||
    n.includes("/library/pnpm/") ||
    n.includes("/local/share/pnpm/") ||
    n.includes("/appdata/local/pnpm/") ||
    n.includes("/pnpm/global/")
  ) {
    return "pnpm";
  }

  // Homebrew (cellar = installed package, /opt/homebrew/bin = symlink shim)
  if (
    n.includes("/cellar/") ||
    n.includes("/caskroom/") ||
    n.startsWith("/opt/homebrew/bin/") ||
    (n.startsWith("/usr/local/bin/") && (n.includes("/cellar/") || n.includes("/caskroom/")))
  ) {
    return "brew";
  }

  // npm global (real path lands under node_modules)
  if (
    n.includes("/node_modules/.bin/") ||
    n.includes("/lib/node_modules/") ||
    n.includes("/npm/node_modules/")
  ) {
    return "npm";
  }

  return "manual";
}

/**
 * Build the human-readable update command for an install method. Returns null
 * when we have no opinion (manual install with no known formula) — UI then
 * shows the recommended npm command and labels install method as "manual".
 */
export function buildUpdateCommand(
  method: ProviderInstallMethod,
  metadata: ProviderPackageMetadata,
): string | null {
  const pkg = metadata.npmPackageName;
  switch (method) {
    case "native":
      return metadata.nativeUpdate?.command ?? null;
    case "bun":
      return `bun i -g ${pkg}@latest`;
    case "pnpm":
      return `pnpm add -g ${pkg}@latest`;
    case "brew":
      return metadata.homebrewFormula ? `brew upgrade ${metadata.homebrewFormula}` : null;
    case "npm":
      return `npm install -g ${pkg}@latest`;
    case "manual":
      // No detected install method — recommend npm as the most portable option
      return `npm install -g ${pkg}@latest`;
  }
}

// ─── I/O helpers ────────────────────────────────────────────────────────────

const VERSION_PROBE_TIMEOUT_MS = 3_000;
const NPM_LATEST_TIMEOUT_MS = 4_000;
const NPM_LATEST_CACHE_TTL_MS = 60 * 60 * 1_000;

interface NpmLatestCacheEntry {
  expiresAt: number;
  version: string | null;
}
const npmLatestCache = new Map<string, NpmLatestCacheEntry>();

/**
 * Run `<binary> --version` and parse the first semver-looking token from the
 * output. Returns null on any failure (timeout, nonzero exit, unparseable
 * output, missing binary).
 */
export function getInstalledVersion(binary: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const child = execFile(
      binary,
      ["--version"],
      { timeout: VERSION_PROBE_TIMEOUT_MS, encoding: "utf8" },
      (err: ExecFileException | null, stdout, stderr) => {
        if (err) {
          finish(null);
          return;
        }
        const combined = `${stdout ?? ""}\n${stderr ?? ""}`;
        const match = combined.match(/\bv?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\b/);
        finish(match ? match[1] : null);
      },
    );
    child.on("error", () => finish(null));
  });
}

/**
 * Get the latest published version of an npm package. Cached in-memory for
 * 1h to avoid hammering the registry on each refresh cycle. Caller can pass
 * `{ force: true }` to bypass the cache (used by the manual recheck endpoint).
 * Returns null on any failure — caller falls back to status "unknown".
 */
export async function fetchNpmLatest(
  packageName: string,
  options: { force?: boolean } = {},
): Promise<string | null> {
  const now = Date.now();
  if (!options.force) {
    const cached = npmLatestCache.get(packageName);
    if (cached && cached.expiresAt > now) {
      return cached.version;
    }
  }

  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NPM_LATEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      npmLatestCache.set(packageName, { expiresAt: now + NPM_LATEST_CACHE_TTL_MS, version: null });
      return null;
    }
    const json = (await res.json()) as { version?: unknown };
    const version =
      typeof json.version === "string" && json.version.trim().length > 0
        ? json.version.trim()
        : null;
    npmLatestCache.set(packageName, { expiresAt: now + NPM_LATEST_CACHE_TTL_MS, version });
    return version;
  } catch {
    // Network error / abort / parse failure: cache the null briefly so we don't
    // retry on every refresh cycle, but expire quickly so a transient network
    // outage doesn't suppress advisories for the full hour.
    npmLatestCache.set(packageName, { expiresAt: now + 60_000, version: null });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a binary's realpath. Falls back to the original path if realpath
 * fails (e.g. broken symlink); caller's install-method classifier handles
 * unknown paths by returning "manual".
 */
function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

// ─── Orchestration ──────────────────────────────────────────────────────────

export interface BuildVersionAdvisoryInput {
  provider: ProviderKind;
  binaryPath: string | null;
  /** Force-bypass the npm registry cache (used by manual recheck endpoint) */
  force?: boolean;
}

/**
 * Probe an installed provider and produce a version advisory. Never throws —
 * returns `status: "unknown"` for any failure path so the UI shows nothing
 * instead of an error state.
 */
export async function buildVersionAdvisory(
  input: BuildVersionAdvisoryInput,
): Promise<ProviderVersionAdvisory> {
  const metadata = PROVIDER_PACKAGE_METADATA[input.provider];
  const checkedAt = new Date().toISOString();
  const baseUnknown: ProviderVersionAdvisory = {
    status: "unknown",
    currentVersion: null,
    latestVersion: null,
    packageName: metadata?.npmPackageName ?? null,
    updateCommand: null,
    installMethod: null,
    checkedAt: null,
  };

  if (!metadata || !input.binaryPath) {
    return baseUnknown;
  }

  const [currentVersion, latestVersion] = await Promise.all([
    getInstalledVersion(input.binaryPath),
    fetchNpmLatest(metadata.npmPackageName, { force: input.force }),
  ]);

  const installMethod = classifyInstallMethod(safeRealpath(input.binaryPath), metadata);
  const updateCommand = buildUpdateCommand(installMethod, metadata);

  if (!currentVersion || !latestVersion) {
    return {
      ...baseUnknown,
      currentVersion,
      latestVersion,
      installMethod,
      updateCommand,
      checkedAt,
    };
  }

  const cmp = compareSemver(currentVersion, latestVersion);
  return {
    status: cmp < 0 ? "behind_latest" : "current",
    currentVersion,
    latestVersion,
    packageName: metadata.npmPackageName,
    updateCommand,
    installMethod,
    checkedAt,
  };
}
