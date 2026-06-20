import "./test-env.js";
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  findProjectIcon,
  scoreIconCandidate,
  readManifestCandidates,
  readAppIconSet,
} from "../dist/server/core/favicon-scanner.js";

/**
 * Build a temp project rooted at a tmp dir. `files` is { relPath: contents }.
 * Creates a fake `.git` so `findProjectIcon` runs (it bails on non-git dirs).
 * String values are written as text; Buffer values written as-is so test
 * fixtures can include binary-ish placeholders.
 */
function makeProject(files) {
  const root = mkdtempSync(join(tmpdir(), "relay-favicon-"));
  // Sentinel git dir so the scanner doesn't short-circuit.
  mkdirSync(join(root, ".git"), { recursive: true });
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

describe("scoreIconCandidate", () => {
  it("rejects non-image extensions", () => {
    assert.equal(scoreIconCandidate("favicon.txt"), null);
    assert.equal(scoreIconCandidate("README.md"), null);
  });

  it("rejects images that don't look like icons", () => {
    assert.equal(scoreIconCandidate("hero.png"), null);
    assert.equal(scoreIconCandidate("screenshot-2.jpg"), null);
  });

  it("rejects Next.js opengraph-image and twitter-image conventions", () => {
    assert.equal(scoreIconCandidate("opengraph-image.png"), null);
    assert.equal(scoreIconCandidate("twitter-image.png"), null);
    assert.equal(scoreIconCandidate("twitter_image.png"), null);
  });

  it("ranks svg favicon above raster apple-touch", () => {
    const svg = scoreIconCandidate("favicon.svg");
    const apple = scoreIconCandidate("apple-touch-icon.png");
    assert.ok(svg > apple, `expected svg(${svg}) > apple-touch(${apple})`);
  });

  it("ranks apple-touch above plain favicon.png", () => {
    const apple = scoreIconCandidate("apple-touch-icon.png");
    const plain = scoreIconCandidate("favicon.png");
    assert.ok(apple > plain, `expected apple(${apple}) > favicon.png(${plain})`);
  });

  it("ranks favicon above logo (logo is last resort)", () => {
    assert.ok(scoreIconCandidate("favicon.png") > scoreIconCandidate("logo.png"));
    assert.ok(scoreIconCandidate("favicon.svg") > scoreIconCandidate("logo.svg"));
  });

  it("penalizes legacy .ico vs .png", () => {
    assert.ok(scoreIconCandidate("favicon.png") > scoreIconCandidate("favicon.ico"));
  });

  it("extracts size hints from the filename", () => {
    const big = scoreIconCandidate("icon-512x512.png");
    const small = scoreIconCandidate("icon-32x32.png");
    assert.ok(big > small);
  });

  it("matches prefixed icon filenames (app-icon, project-name-icon)", () => {
    assert.ok(scoreIconCandidate("usage-meter-app-icon.png") !== null);
    assert.ok(scoreIconCandidate("my-app-icon.png") !== null);
    assert.ok(scoreIconCandidate("ghin-plus-favicon.svg") !== null);
  });

  it("matches Next.js apple-icon (not just apple-touch-icon)", () => {
    assert.ok(scoreIconCandidate("apple-icon.png") !== null);
  });
});

describe("readAppIconSet", () => {
  let root;
  afterEach(() => {
    if (root) cleanup(root);
    root = null;
  });

  it("returns null when Contents.json is missing", () => {
    root = mkdtempSync(join(tmpdir(), "relay-favicon-xcasset-"));
    const setDir = join(root, "AppIcon.appiconset");
    mkdirSync(setDir, { recursive: true });
    assert.equal(readAppIconSet(setDir), null);
  });

  it("returns the first image whose file exists", () => {
    root = mkdtempSync(join(tmpdir(), "relay-favicon-xcasset-"));
    const setDir = join(root, "AppIcon.appiconset");
    mkdirSync(setDir, { recursive: true });
    writeFileSync(
      join(setDir, "Contents.json"),
      JSON.stringify({
        images: [
          { filename: "missing.png", size: "60x60" }, // doesn't exist
          { filename: "icon-1024.png", size: "1024x1024" },
        ],
      }),
    );
    writeFileSync(join(setDir, "icon-1024.png"), "fake");
    assert.equal(readAppIconSet(setDir), join(setDir, "icon-1024.png"));
  });
});

describe("readManifestCandidates", () => {
  let root;
  afterEach(() => {
    if (root) cleanup(root);
    root = null;
  });

  it("returns scored candidates from a PWA manifest", () => {
    root = makeProject({
      "site.webmanifest": JSON.stringify({
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192" },
          { src: "/icons/icon-512.png", sizes: "512x512" },
        ],
      }),
      "icons/icon-192.png": "fake",
      "icons/icon-512.png": "fake",
    });
    const out = readManifestCandidates(join(root, "site.webmanifest"));
    assert.equal(out.length, 2);
    const byPath = Object.fromEntries(out.map((c) => [c.path, c.score]));
    assert.ok(
      byPath[join(root, "icons", "icon-512.png")] > byPath[join(root, "icons", "icon-192.png")],
      "512 should outscore 192 within manifest",
    );
  });

  it("skips icons whose src file does not exist", () => {
    root = makeProject({
      "site.webmanifest": JSON.stringify({
        icons: [
          { src: "/icons/missing.png", sizes: "192x192" },
          { src: "/icons/real.png", sizes: "512x512" },
        ],
      }),
      "icons/real.png": "fake",
    });
    const out = readManifestCandidates(join(root, "site.webmanifest"));
    assert.equal(out.length, 1);
    assert.equal(out[0].path, join(root, "icons", "real.png"));
  });

  it("downgrades maskable-only icons vs any-purpose", () => {
    root = makeProject({
      "manifest.json": JSON.stringify({
        icons: [
          { src: "/a.png", sizes: "512x512", purpose: "any" },
          { src: "/m.png", sizes: "512x512", purpose: "maskable" },
          { src: "/both.png", sizes: "512x512", purpose: "any maskable" },
        ],
      }),
      "a.png": "fake",
      "m.png": "fake",
      "both.png": "fake",
    });
    const out = readManifestCandidates(join(root, "manifest.json"));
    const byBase = Object.fromEntries(out.map((c) => [c.path.split("/").pop(), c.score]));
    assert.ok(byBase["a.png"] > byBase["m.png"], "any > maskable-only");
    assert.equal(byBase["a.png"], byBase["both.png"], "'any maskable' should not be downgraded");
  });

  it("parses browser-extension shape ({ '48': 'icon48.png' })", () => {
    root = makeProject({
      "manifest.json": JSON.stringify({ icons: { 48: "icon48.png", 128: "icon128.png" } }),
      "icon48.png": "fake",
      "icon128.png": "fake",
    });
    const out = readManifestCandidates(join(root, "manifest.json"));
    assert.equal(out.length, 2);
    const byBase = Object.fromEntries(out.map((c) => [c.path.split("/").pop(), c.score]));
    assert.ok(byBase["icon128.png"] > byBase["icon48.png"]);
  });
});

describe("findProjectIcon — basic selection", () => {
  let root;
  afterEach(() => {
    if (root) cleanup(root);
    root = null;
  });

  it("returns null on a non-git directory", () => {
    root = mkdtempSync(join(tmpdir(), "relay-favicon-nogit-"));
    writeFileSync(join(root, "favicon.svg"), "fake");
    assert.equal(findProjectIcon(root), null);
  });

  it("returns null when no candidate is found", () => {
    root = makeProject({ "README.md": "hi" });
    assert.equal(findProjectIcon(root), null);
  });

  it("picks favicon.svg over apple-touch-icon.png in the same dir", () => {
    root = makeProject({
      "public/favicon.svg": "fake",
      "public/apple-touch-icon.png": "fake",
    });
    assert.equal(findProjectIcon(root), join(root, "public", "favicon.svg"));
  });

  it("picks apple-touch-icon.png over favicon.png", () => {
    root = makeProject({
      "public/favicon.png": "fake",
      "public/apple-touch-icon.png": "fake",
    });
    assert.equal(findProjectIcon(root), join(root, "public", "apple-touch-icon.png"));
  });

  it("rejects opengraph-image even when it's the only PNG", () => {
    root = makeProject({ "src/app/opengraph-image.png": "fake" });
    assert.equal(findProjectIcon(root), null);
  });
});

describe("findProjectIcon — monorepo and prefixed names (regression cases)", () => {
  let root;
  afterEach(() => {
    if (root) cleanup(root);
    root = null;
  });

  it("ghin-plus regression: picks the SVG in apps/web/public, not mobile assets", () => {
    // Mirrors the real project layout that triggered this rewrite.
    root = makeProject({
      "apps/mobile/assets/images/icon.png": "fake",
      "apps/mobile/assets/images/favicon.png": "fake",
      "apps/web/public/apple-touch-icon.png": "fake",
      "apps/web/public/apple-touch-icon-152.png": "fake",
      "apps/web/public/icon-192.png": "fake",
      "apps/web/public/logo.svg": "fake",
      "apps/web/public/favicon.svg": "fake",
      "apps/web/public/icon-512.png": "fake",
    });
    assert.equal(findProjectIcon(root), join(root, "apps", "web", "public", "favicon.svg"));
  });

  it("usage-meter regression: picks the prefixed app-icon over the prefixed logo", () => {
    // Mirrors the Swift Package Manager layout.
    root = makeProject({
      "Sources/UsageMeter/Resources/usage-meter-logo.svg": "fake",
      "Sources/UsageMeter/Resources/usage-meter-app-icon.png": "fake",
    });
    assert.equal(
      findProjectIcon(root),
      join(root, "Sources", "UsageMeter", "Resources", "usage-meter-app-icon.png"),
    );
  });

  it("projectNames bias breaks ties between equally-good icons in different apps", () => {
    // Two apps, each with apple-touch-icon.png at the same depth/score.
    // The one whose path segment matches projectNames should win.
    root = makeProject({
      "apps/admin/public/apple-touch-icon.png": "fake",
      "apps/web/public/apple-touch-icon.png": "fake",
    });
    assert.equal(
      findProjectIcon(root, { projectNames: ["web"] }),
      join(root, "apps", "web", "public", "apple-touch-icon.png"),
    );
    assert.equal(
      findProjectIcon(root, { projectNames: ["admin"] }),
      join(root, "apps", "admin", "public", "apple-touch-icon.png"),
    );
  });

  it("deterministic tie-breakers: shallower path wins when scores match", () => {
    root = makeProject({
      "public/favicon.svg": "fake",
      "apps/web/public/favicon.svg": "fake",
    });
    // Both score the same (svg favicon). With no projectNames bias, shallower
    // wins. Pass an empty projectNames array AND override the default basename
    // bias by giving a name that doesn't match either path segment.
    const result = findProjectIcon(root, { projectNames: ["zzz-nonexistent"] });
    assert.equal(result, join(root, "public", "favicon.svg"));
  });
});

describe("findProjectIcon — manifest integration", () => {
  let root;
  afterEach(() => {
    if (root) cleanup(root);
    root = null;
  });

  it("manifest-declared icon with a hashed filename beats a stray logo.png", () => {
    // The scenario from review finding #1: a Vite/PWA build emits hashed icon
    // names that don't match the keyword regex. They should still win because
    // the manifest declares them as the app's icons.
    root = makeProject({
      "src/marketing/logo.png": "fake", // would score 3000 + size hint
      "public/site.webmanifest": JSON.stringify({
        icons: [{ src: "/assets/icon.abc123.png", sizes: "512x512", purpose: "any" }],
      }),
      "public/assets/icon.abc123.png": "fake",
    });
    const result = findProjectIcon(root);
    assert.equal(result, join(root, "public", "assets", "icon.abc123.png"));
  });

  it("when two manifests exist, the one with the larger declared icon wins", () => {
    // Each app declares an apple-touch-tier icon, but app-b's is 512 vs app-a's 192.
    // App-a's manifest is encountered FIRST by walk order — the old code returned
    // it as the manifest-fallback. The new code scores manifest icons globally.
    root = makeProject({
      "apps/aaaa/site.webmanifest": JSON.stringify({
        icons: [{ src: "/icon.png", sizes: "192x192", purpose: "any" }],
      }),
      "apps/aaaa/icon.png": "fake",
      "apps/zzzz/site.webmanifest": JSON.stringify({
        icons: [{ src: "/icon.png", sizes: "512x512", purpose: "any" }],
      }),
      "apps/zzzz/icon.png": "fake",
    });
    const result = findProjectIcon(root, { projectNames: ["nonmatching"] });
    assert.equal(result, join(root, "apps", "zzzz", "icon.png"));
  });
});

describe("findProjectIcon — Xcode appiconset", () => {
  let root;
  afterEach(() => {
    if (root) cleanup(root);
    root = null;
  });

  it("uses Assets.xcassets/AppIcon.appiconset when no other icons exist", () => {
    root = makeProject({
      "Assets.xcassets/AppIcon.appiconset/Contents.json": JSON.stringify({
        images: [{ filename: "icon-1024.png", size: "1024x1024" }],
      }),
      "Assets.xcassets/AppIcon.appiconset/icon-1024.png": "fake",
    });
    assert.equal(
      findProjectIcon(root),
      join(root, "Assets.xcassets", "AppIcon.appiconset", "icon-1024.png"),
    );
  });
});

describe("findProjectIcon — budget caps", () => {
  let root;
  afterEach(() => {
    if (root) cleanup(root);
    root = null;
  });

  it("skips noise directories so node_modules can't poison the result", () => {
    root = makeProject({
      "node_modules/some-pkg/public/favicon.svg": "fake",
      "public/favicon.png": "fake",
    });
    // The node_modules svg would outscore favicon.png if scanned — but
    // node_modules is in the skip list, so only the .png is found.
    assert.equal(findProjectIcon(root), join(root, "public", "favicon.png"));
  });

  it("respects maxIconCandidates without missing a manifest that's already collected", () => {
    // Pack the tree with many low-score logos so we hit the icon-budget cap
    // partway through, then verify the manifest icon (collected first per dir)
    // can still win.
    const files = {
      "public/site.webmanifest": JSON.stringify({
        icons: [{ src: "/best.png", sizes: "1024x1024", purpose: "any" }],
      }),
      "public/best.png": "fake",
    };
    for (let i = 0; i < 50; i++) {
      files[`junk-${i}/logo.png`] = "fake";
    }
    root = makeProject(files);
    const result = findProjectIcon(root, { maxIconCandidates: 5, projectNames: ["x"] });
    // The manifest-declared 1024 icon scores far above any logo.png.
    assert.equal(result, join(root, "public", "best.png"));
  });
});
