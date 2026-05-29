import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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
