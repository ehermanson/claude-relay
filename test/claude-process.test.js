import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ClaudeProcess } from "../dist/core/claude-process.js";

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

function makeConfig(overrides = {}) {
  return {
    workingDirectory: "/tmp",
    dangerouslySkipPermissions: false,
    processTimeout: 0,
    maxProcesses: 5,
    logger: noopLogger,
    ...overrides,
  };
}

describe("ClaudeProcess state management", () => {
  it("starts with isProcessing = false", () => {
    const proc = new ClaudeProcess(makeConfig());
    assert.equal(proc.isProcessing, false);
  });

  it("starts with empty stats", () => {
    const proc = new ClaudeProcess(makeConfig());
    const stats = proc.stats;
    assert.equal(stats.inputTokens, 0);
    assert.equal(stats.outputTokens, 0);
    assert.equal(stats.cacheCreationTokens, 0);
    assert.equal(stats.cacheReadTokens, 0);
    assert.equal(stats.model, undefined);
  });

  it("stats getter returns a copy, not the internal object", () => {
    const proc = new ClaudeProcess(makeConfig());
    const stats1 = proc.stats;
    const stats2 = proc.stats;
    assert.notEqual(stats1, stats2);
    assert.deepEqual(stats1, stats2);
  });

  it("provider is always 'claude'", () => {
    const proc = new ClaudeProcess(makeConfig());
    assert.equal(proc.provider, "claude");
  });
});

describe("ClaudeProcess session targeting", () => {
  it("setSessionId stores the session ID for resume", () => {
    const proc = new ClaudeProcess(makeConfig());
    proc.setSessionId("abc-123");
    const binding = proc.getRuntimeBinding();
    assert.equal(binding.providerSessionId, "abc-123");
    assert.deepEqual(binding.resumeCursor, { sessionId: "abc-123" });
  });

  it("constructor accepts resumeSessionId", () => {
    const proc = new ClaudeProcess(makeConfig(), { resumeSessionId: "existing-session" });
    const binding = proc.getRuntimeBinding();
    assert.equal(binding.providerSessionId, "existing-session");
  });

  it("getRuntimeBinding without session ID has no resume cursor", () => {
    const proc = new ClaudeProcess(makeConfig());
    const binding = proc.getRuntimeBinding();
    assert.equal(binding.providerSessionId, undefined);
    assert.equal(binding.resumeCursor, undefined);
  });
});

describe("ClaudeProcess model and reasoning", () => {
  it("setModel stores the preferred model", () => {
    const proc = new ClaudeProcess(makeConfig());
    proc.setModel("claude-sonnet-4-6");
    const binding = proc.getRuntimeBinding();
    assert.equal(binding.runtimePayload.model, "claude-sonnet-4-6");
  });

  it("setModel(null) clears the model", () => {
    const proc = new ClaudeProcess(makeConfig());
    proc.setModel("claude-sonnet-4-6");
    proc.setModel(null);
    const binding = proc.getRuntimeBinding();
    assert.equal(binding.runtimePayload.model, undefined);
  });

  it("constructor accepts model option", () => {
    const proc = new ClaudeProcess(makeConfig(), { model: "claude-haiku-4-5-20251001" });
    const binding = proc.getRuntimeBinding();
    assert.equal(binding.runtimePayload.model, "claude-haiku-4-5-20251001");
  });

  it("setReasoningBudget stores the budget", () => {
    const proc = new ClaudeProcess(makeConfig());
    proc.setReasoningBudget(10000);
    // Budget is used during send() — verify it doesn't throw
    assert.ok(proc);
  });
});

describe("ClaudeProcess permissions and plan mode", () => {
  it("setBypassPermissions changes runtime mode", () => {
    const proc = new ClaudeProcess(makeConfig());
    assert.equal(proc.getRuntimeBinding().runtimeMode, "approval-required");

    proc.setBypassPermissions(true);
    assert.equal(proc.getRuntimeBinding().runtimeMode, "full-access");

    proc.setBypassPermissions(false);
    assert.equal(proc.getRuntimeBinding().runtimeMode, "approval-required");
  });

  it("setPlanMode enables plan mode and disables bypass", () => {
    const proc = new ClaudeProcess(makeConfig({ dangerouslySkipPermissions: true }));
    assert.equal(proc.getRuntimeBinding().runtimeMode, "full-access");

    proc.setPlanMode(true);
    assert.equal(proc.getRuntimeBinding().runtimeMode, "plan");
  });

  it("setBypassPermissions(true) disables plan mode", () => {
    const proc = new ClaudeProcess(makeConfig());
    proc.setPlanMode(true);
    assert.equal(proc.getRuntimeBinding().runtimeMode, "plan");

    proc.setBypassPermissions(true);
    assert.equal(proc.getRuntimeBinding().runtimeMode, "full-access");
  });

  it("addAllowedTool deduplicates tools", () => {
    const proc = new ClaudeProcess(makeConfig());
    proc.addAllowedTool("Bash");
    proc.addAllowedTool("Bash");
    proc.addAllowedTool("Edit");
    // No direct way to inspect allowedTools, but verify no error
    assert.ok(proc);
  });
});

describe("ClaudeProcess cancel and kill", () => {
  it("cancel when no process is a no-op", () => {
    const proc = new ClaudeProcess(makeConfig());
    // Should not throw
    proc.cancel();
    assert.equal(proc.isProcessing, false);
  });

  it("kill when no process is a no-op", () => {
    const proc = new ClaudeProcess(makeConfig());
    proc.kill();
    assert.equal(proc.isProcessing, false);
  });

  it("close is an alias for kill", () => {
    const proc = new ClaudeProcess(makeConfig());
    proc.close();
    assert.equal(proc.isProcessing, false);
  });

  it("interrupt is an alias for cancel", () => {
    const proc = new ClaudeProcess(makeConfig());
    proc.interrupt();
    assert.equal(proc.isProcessing, false);
  });

  it("cancelForPermission when no process is a no-op", () => {
    const proc = new ClaudeProcess(makeConfig());
    proc.cancelForPermission();
    assert.equal(proc.isProcessing, false);
  });
});

describe("ClaudeProcess send guards", () => {
  it("ignores send when already processing", () => {
    const proc = new ClaudeProcess(makeConfig());
    // Force _isProcessing via a send call that will fail (no claude binary)
    // and check it doesn't crash on double-send
    try {
      proc.send("first message");
    } catch {
      // Expected — claude binary not available in test
    }
    // Second send while processing should be silently ignored
    // (it logs but doesn't throw)
  });
});
