import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildEffectiveProviderCapabilities,
  getProviderDriver,
  getProviderCapabilities,
  getRegisteredProviders,
  inferClaudeModelIdFromSdkInfo,
  listAvailableProviders,
  resolveCoreConfig,
} from "../dist/server/core/index.js";

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

function makeContext() {
  const config = resolveCoreConfig({ logger: noopLogger });
  return {
    providerDirs: {
      claude: config.providerDirs.claude,
      codex: config.providerDirs.codex,
      gemini: config.providerDirs.gemini,
    },
    logger: noopLogger,
    sdkQueryFn: null,
  };
}

describe("provider registry", () => {
  it("only exposes Codex writes mode for CLI 0.144.0 or newer", () => {
    const base = getProviderDriver("codex").capabilities;
    const advisory = (currentVersion) => ({
      status: "current",
      currentVersion,
      latestVersion: currentVersion,
      packageName: "@openai/codex",
      updateCommand: null,
      installMethod: "manual",
      checkedAt: new Date().toISOString(),
    });

    assert.equal(
      buildEffectiveProviderCapabilities("codex", base, advisory("0.143.9")).runtimeModes?.[
        "writes-only"
      ],
      undefined,
    );
    assert.ok(
      buildEffectiveProviderCapabilities("codex", base, advisory("0.144.0")).runtimeModes?.[
        "writes-only"
      ],
    );
    assert.ok(
      buildEffectiveProviderCapabilities("codex", base, advisory("0.145.0-alpha.1")).runtimeModes?.[
        "writes-only"
      ],
    );
  });

  it("only exposes Claude auto mode for eligible, enabled environments", () => {
    const base = getProviderDriver("claude").capabilities;
    const capabilities = (env, settings = null) =>
      buildEffectiveProviderCapabilities("claude", base, undefined, {
        env,
        claudeUserSettings: settings,
      });

    assert.equal(capabilities({}).runtimeModes?.auto, undefined);
    assert.ok(capabilities({ CLAUDE_CODE_USE_BEDROCK: "1" }).runtimeModes?.auto);
    assert.ok(capabilities({ CLAUDE_CODE_ENABLE_AUTO_MODE: "true" }).runtimeModes?.auto);
    assert.equal(
      capabilities({ CLAUDE_CODE_USE_VERTEX: "1" }, { disableAutoMode: "disable" }).runtimeModes
        ?.auto,
      undefined,
    );
  });

  it("registers drivers for all known provider kinds", () => {
    assert.deepEqual(getRegisteredProviders().sort(), ["claude", "codex", "gemini"]);
  });

  it("exposes fixed capability metadata for each driver", () => {
    for (const provider of getRegisteredProviders()) {
      const capabilities = getProviderCapabilities(provider);
      assert.equal(typeof capabilities.supportsResume, "boolean");
      assert.equal(typeof capabilities.supportsTranscriptReplay, "boolean");
      assert.equal(typeof capabilities.supportsApprovals, "boolean");
      assert.equal(typeof capabilities.supportsUserInputRequests, "boolean");
      assert.equal(typeof capabilities.supportsModelSelection, "boolean");
      assert.equal(typeof capabilities.supportsTitleUpdates, "boolean");
    }
  });

  it("keeps gemini out of the available provider catalog until it is supported", () => {
    const available = listAvailableProviders(makeContext());
    assert.ok(!available.some((provider) => provider.provider === "gemini"));
  });

  it("infers canonical Claude model ids from SDK model descriptions", () => {
    const inferred = inferClaudeModelIdFromSdkInfo({
      value: "default",
      displayName: "Default (recommended)",
      description: "Opus 4.8 with 1M context · Most capable for complex work",
    });
    assert.equal(inferred, "claude-opus-4-8");
  });

  it("resolves managed transcript paths through the provider driver", () => {
    const claudePath = getProviderDriver("claude").resolveManagedTranscriptPath({
      providerDirs: {
        claude: "/tmp/.claude",
        codex: "/tmp/.codex",
        gemini: "/tmp/.gemini",
      },
      sessionId: "session-123",
      workingDirectory: "/tmp/project",
    });
    assert.equal(claudePath, join("/tmp/.claude", "projects", "-tmp-project", "session-123.jsonl"));
  });

  it("finds Claude transcript paths for dotted relay worktree directories", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "relay-provider-registry-"));
    const claudeDir = join(tempDir, ".claude");
    const encodedProjectDir = "-Users-test--relay-worktrees-space-262013e4";
    mkdirSync(join(claudeDir, "projects", encodedProjectDir), { recursive: true });

    const claudePath = getProviderDriver("claude").resolveManagedTranscriptPath({
      providerDirs: {
        claude: claudeDir,
        codex: join(tempDir, ".codex"),
        gemini: join(tempDir, ".gemini"),
      },
      sessionId: "session-123",
      workingDirectory: "/Users/test/.relay/worktrees/space-262013e4",
    });

    assert.equal(claudePath, join(claudeDir, "projects", encodedProjectDir, "session-123.jsonl"));
  });
});
