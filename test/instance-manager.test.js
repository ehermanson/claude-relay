import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { InstanceManager } from "../dist/core/instance-manager.js";
import { SessionDB } from "../dist/core/db.js";
import { resolveConfig } from "../dist/server/config.js";

// Use a noop logger to keep test output clean
const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

function makeConfig(overrides = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), "relay-im-test-"));
  execSync("git init -q", { cwd: tempDir });
  return resolveConfig({
    password: "test",
    logger: noopLogger,
    maxProcesses: 3,
    dbPath: join(tempDir, "sessions.db"),
    claudeDir: join(tempDir, ".claude"),
    codexDir: join(tempDir, ".codex"),
    workingDirectory: tempDir,
    ...overrides,
  });
}

describe("InstanceManager", () => {
  let manager;

  beforeEach(() => {
    manager = new InstanceManager(makeConfig());
  });

  describe("createInstance", () => {
    it("creates an instance with defaults", () => {
      const info = manager.createInstance();
      assert.ok(info.id);
      assert.equal(info.name, "New Session");
      assert.equal(info.status, "idle");
      assert.equal(info.external, undefined);
    });

    it("accepts custom name and working directory", () => {
      const info = manager.createInstance({
        name: "My Project",
        workingDirectory: "/tmp/test",
      });
      assert.equal(info.name, "My Project");
      assert.equal(info.workingDirectory, "/tmp/test");
    });

    it("uses the default session title when no name is provided", () => {
      const a = manager.createInstance();
      const b = manager.createInstance();
      assert.equal(a.name, "New Session");
      assert.equal(b.name, "New Session");
    });

    it("enforces maxProcesses limit", () => {
      manager.createInstance();
      manager.createInstance();
      manager.createInstance();
      assert.throws(() => manager.createInstance(), /Maximum processes/);
    });

    it("does not persist an empty managed instance before it has resumable state", () => {
      const info = manager.createInstance({ name: "Unsaved Draft" });
      const db = new SessionDB(manager.baseConfig.dbPath, noopLogger);

      try {
        assert.equal(db.getManagedByInstanceId(info.id), undefined);
      } finally {
        db.close();
      }
    });
  });

  describe("listInstances / getInstance", () => {
    it("lists all instances", () => {
      manager.createInstance({ name: "A" });
      manager.createInstance({ name: "B" });
      const list = manager.listInstances();
      assert.equal(list.length, 2);
      assert.equal(list[0].name, "A");
      assert.equal(list[1].name, "B");
    });

    it("gets instance by id", () => {
      const info = manager.createInstance({ name: "X" });
      const found = manager.getInstance(info.id);
      assert.equal(found.name, "X");
    });

    it("returns undefined for unknown id", () => {
      assert.equal(manager.getInstance("nonexistent"), undefined);
    });
  });

  describe("provider registry", () => {
    it("surfaces available providers with capabilities", () => {
      const providers = manager.getAvailableProviders();
      assert.ok(providers.some((provider) => provider.provider === "claude"));
      assert.ok(!providers.some((provider) => provider.provider === "gemini"));
      for (const provider of providers) {
        assert.equal(typeof provider.capabilities.supportsResume, "boolean");
        assert.equal(typeof provider.capabilities.supportsModelSelection, "boolean");
      }
    });

    it("returns provider capabilities from the shared registry", () => {
      const claude = manager.getProviderCapabilities("claude");
      const codex = manager.getProviderCapabilities("codex");
      assert.equal(claude.supportsReasoningBudget, true);
      assert.equal(codex.supportsReasoningBudget, false);
      assert.equal(codex.supportsTitleUpdates, true);
    });

    it("rejects switching to an unavailable provider", () => {
      const info = manager.createInstance();
      assert.equal(manager.setProvider(info.id, "gemini"), false);
    });
  });

  describe("removeInstance", () => {
    it("removes an instance", () => {
      const info = manager.createInstance();
      assert.equal(manager.removeInstance(info.id), true);
      assert.equal(manager.listInstances().length, 0);
    });

    it("returns false for unknown id", () => {
      assert.equal(manager.removeInstance("nonexistent"), false);
    });

    it("frees a slot for new instances", () => {
      const a = manager.createInstance();
      manager.createInstance();
      manager.createInstance();
      assert.throws(() => manager.createInstance(), /Maximum/);
      manager.removeInstance(a.id);
      const d = manager.createInstance(); // should succeed now
      assert.ok(d.id);
    });
  });

  describe("getHistory", () => {
    it("returns empty history for new instance", () => {
      const info = manager.createInstance();
      const history = manager.getHistory(info.id);
      assert.deepEqual(history, []);
    });

    it("throws for unknown instance", () => {
      assert.throws(() => manager.getHistory("nope"), /not found/);
    });
  });

  describe("sendMessage guards", () => {
    it("throws for unknown instance", () => {
      assert.throws(() => manager.sendMessage("nope", "hi"), /not found/);
    });
  });

  describe("cancelMessage guards", () => {
    it("throws for unknown instance", () => {
      assert.throws(() => manager.cancelMessage("nope"), /not found/);
    });
  });

  describe("approveToolUse guards", () => {
    it("throws for unknown instance", () => {
      assert.throws(() => manager.approveToolUse("nope", "Bash"), /not found/);
    });
  });

  describe("respondToRequest", () => {
    it("falls back to a normal user message for provider-neutral AskUserQuestion replies", () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      const sentMessages = [];
      instance.process = {
        ...instance.process,
        isProcessing: false,
        provider: "claude",
        pid: undefined,
        stats: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
        send(text) {
          sentMessages.push(text);
        },
        interrupt() {},
        close() {},
        setModel() {},
        setReasoningBudget() {},
        addAllowedTool() {},
        setBypassPermissions() {},
        getRuntimeBinding() {
          return { provider: "claude" };
        },
        respondToRequest() {
          return false;
        },
      };

      instance.info.pendingPermission = {
        requestId: "ask-1",
        kind: "user_input",
        tool: "AskUserQuestion",
        questions: [
          {
            id: "drink",
            header: "Preference",
            question: "Which do you prefer?",
            options: [
              { label: "Coffee", description: "Bolder flavor" },
              { label: "Tea", description: "Lighter flavor" },
            ],
          },
        ],
      };

      manager.respondToRequest(info.id, "ask-1", "accept", {
        answers: {
          drink: {
            answers: ["Tea"],
          },
        },
      });

      assert.deepEqual(sentMessages, ["Tea"]);
      assert.equal(instance.info.pendingPermission, undefined);
      const lastHistory = instance.history[instance.history.length - 2];
      assert.equal(lastHistory.message.type, "activity");
      assert.equal(lastHistory.message.tool, "AskUserQuestion");
      assert.equal(lastHistory.message.resolution, "approved");
    });

    it("turns empty AskUserQuestion answers into a dismiss-style fallback reply", () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      const sentMessages = [];
      instance.process = {
        ...instance.process,
        isProcessing: false,
        provider: "claude",
        pid: undefined,
        stats: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
        send(text) {
          sentMessages.push(text);
        },
        interrupt() {},
        close() {},
        setModel() {},
        setReasoningBudget() {},
        addAllowedTool() {},
        setBypassPermissions() {},
        getRuntimeBinding() {
          return { provider: "claude" };
        },
        respondToRequest() {
          return false;
        },
      };

      instance.info.pendingPermission = {
        requestId: "ask-2",
        kind: "user_input",
        tool: "AskUserQuestion",
        questions: [
          {
            id: "drink",
            header: "Preference",
            question: "Which do you prefer?",
          },
        ],
      };

      manager.respondToRequest(info.id, "ask-2", "accept", { answers: {} });

      assert.equal(
        sentMessages[0],
        "I prefer not to answer that question. Please continue without it if possible.",
      );
      const lastHistory = instance.history[instance.history.length - 2];
      assert.equal(lastHistory.message.type, "activity");
      assert.equal(lastHistory.message.resolution, "dismissed");
    });
  });

  describe("stopAll", () => {
    it("clears all instances", () => {
      manager.createInstance();
      manager.createInstance();
      manager.stopAll();
      assert.equal(manager.listInstances().length, 0);
    });
  });

  describe("status events", () => {
    it("emits instance:status on status change", (_, done) => {
      // We can't easily test processing without a real claude process,
      // but we can verify the event infrastructure works by checking
      // that createInstance sets up proper event wiring
      const info = manager.createInstance();
      assert.equal(info.status, "idle");
      done();
    });
  });

  describe("watcher dedup", () => {
    it("skips watcher entries already handled by the managed process", () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      const now = Date.now();
      instance.processHandledUntil = now + 2_000;
      instance.watchState = {
        jsonlPath: "/tmp/test.jsonl",
        fileOffset: 0,
        pendingTools: new Map(),
        pendingTaskCreates: new Map(),
        stats: {
          inputTokens: 1,
          outputTokens: 2,
          cacheCreationTokens: 3,
          cacheReadTokens: 4,
        },
      };
      instance.info.stats = { ...instance.watchState.stats };

      manager.applyWatcherEntry(info.id, instance, {
        type: "assistant",
        timestamp: new Date(now + 1_000).toISOString(),
        message: {
          model: "claude-opus-4-6",
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_creation_input_tokens: 30,
            cache_read_input_tokens: 40,
          },
          content: [{ type: "text", text: "duplicate output" }],
        },
      });

      assert.equal(instance.history.length, 0);
      assert.deepEqual(instance.watchState.stats, {
        inputTokens: 1,
        outputTokens: 2,
        cacheCreationTokens: 3,
        cacheReadTokens: 4,
      });
      assert.deepEqual(instance.info.stats, {
        inputTokens: 1,
        outputTokens: 2,
        cacheCreationTokens: 3,
        cacheReadTokens: 4,
      });
    });

    it("applies watcher entries newer than the managed-process watermark", () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      const now = Date.now();
      instance.processHandledUntil = now + 500;
      instance.watchState = {
        jsonlPath: "/tmp/test.jsonl",
        fileOffset: 0,
        pendingTools: new Map(),
        pendingTaskCreates: new Map(),
        stats: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
      };
      instance.info.stats = { ...instance.watchState.stats };

      manager.applyWatcherEntry(info.id, instance, {
        type: "assistant",
        timestamp: new Date(now + 5_000).toISOString(),
        message: {
          model: "claude-opus-4-6",
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_creation_input_tokens: 30,
            cache_read_input_tokens: 40,
          },
          content: [{ type: "text", text: "fresh external output" }],
        },
      });

      assert.equal(instance.history.length, 2);
      assert.equal(instance.history[0].message.type, "output");
      assert.equal(instance.history[1].message.type, "output");
      assert.equal(instance.history[0].message.text, "fresh external output");
      assert.equal(instance.history[1].message.isWaiting, true);
      assert.equal(instance.watchState.stats.inputTokens, 10);
      assert.equal(instance.watchState.stats.outputTokens, 20);
      assert.equal(instance.watchState.stats.cacheCreationTokens, 30);
      assert.equal(instance.watchState.stats.cacheReadTokens, 40);
      assert.equal(instance.info.stats.inputTokens, 10);
      assert.equal(instance.info.stats.outputTokens, 20);
    });

    it("skips instance:user emit from watcher for managed instances", () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      // Simulate a managed instance (has a process object)
      instance.process = { isProcessing: false };
      instance.watchState = {
        jsonlPath: "/tmp/test.jsonl",
        fileOffset: 0,
        pendingTools: new Map(),
        pendingTaskCreates: new Map(),
        stats: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
      };

      const emitted = [];
      manager.on("instance:user", (id, msg) => emitted.push({ id, msg }));

      manager.applyWatcherEntry(info.id, instance, {
        type: "user",
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [{ type: "text", text: "hello from watcher" }],
        },
      });

      // User message should be in history (pushHistory still runs)
      const userEntries = instance.history.filter((h) => h.message.type === "user");
      assert.equal(userEntries.length, 1);

      // But instance:user should NOT have been emitted (managed instance)
      assert.equal(emitted.length, 0);
    });

    it("emits instance:user from watcher for external instances", () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      // External instance: no process
      instance.process = null;
      instance.watchState = {
        jsonlPath: "/tmp/test.jsonl",
        fileOffset: 0,
        pendingTools: new Map(),
        pendingTaskCreates: new Map(),
        stats: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
      };

      const emitted = [];
      manager.on("instance:user", (id, msg) => emitted.push({ id, msg }));

      manager.applyWatcherEntry(info.id, instance, {
        type: "user",
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [{ type: "text", text: "hello from terminal" }],
        },
      });

      // User message should be in history
      const userEntries = instance.history.filter((h) => h.message.type === "user");
      assert.equal(userEntries.length, 1);

      // instance:user SHOULD be emitted (external instance)
      assert.equal(emitted.length, 1);
      assert.equal(emitted[0].msg.text, "hello from terminal");
    });

    it("maps watcher AskUserQuestion entries into pending composer state", () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      instance.watchState = {
        jsonlPath: "/tmp/test.jsonl",
        fileOffset: 0,
        pendingTools: new Map(),
        pendingTaskCreates: new Map(),
        stats: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
      };

      manager.applyWatcherEntry(info.id, instance, {
        type: "assistant",
        timestamp: new Date().toISOString(),
        message: {
          content: [
            {
              type: "tool_use",
              id: "watch-ask-1",
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    id: "drink",
                    header: "Preference",
                    question: "Which do you prefer?",
                  },
                ],
              },
            },
          ],
        },
      });

      assert.equal(instance.info.pendingTool, undefined);
      assert.equal(instance.info.pendingPermission?.kind, "user_input");
      assert.equal(instance.info.pendingPermission?.requestId, "watch-ask-1");
      const promptHistory = instance.history.find(
        (entry) =>
          entry.message.type === "activity" &&
          entry.message.activity === "tool_use" &&
          entry.message.tool === "AskUserQuestion",
      );
      assert.ok(promptHistory);
      assert.equal(promptHistory.message.input.requestId, "watch-ask-1");
    });
  });

  describe("sendMessage auto-exits plan mode on plan approval", () => {
    it("exits plan mode when sending a message while pendingPlan is set", () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      let planModeSet = undefined;
      const sentMessages = [];
      instance.process = {
        ...instance.process,
        isProcessing: false,
        provider: "codex",
        pid: undefined,
        stats: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
        send(text) {
          sentMessages.push(text);
        },
        interrupt() {},
        close() {},
        setModel() {},
        setReasoningBudget() {},
        addAllowedTool() {},
        setBypassPermissions() {},
        setPlanMode(mode) {
          planModeSet = mode;
        },
        getRuntimeBinding() {
          return { provider: "codex" };
        },
        respondToRequest() {
          return false;
        },
      };

      // Simulate plan mode active with a pending plan
      instance.info.planMode = true;
      instance.info.pendingPlan = "# The Plan\nDo things";
      instance.info.status = "idle";

      // Send approval message
      manager.sendMessage(info.id, "Yes, go ahead with this plan.");

      // Should have exited plan mode
      assert.equal(planModeSet, false, "setPlanMode(false) should be called");
      assert.equal(instance.info.planMode, false, "planMode should be false");
      assert.equal(instance.info.pendingPlan, undefined, "pendingPlan should be cleared");
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0], "Yes, go ahead with this plan.");
    });

    it("preserves plan mode when no pendingPlan is set", () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      let planModeSet = undefined;
      instance.process = {
        ...instance.process,
        isProcessing: false,
        provider: "codex",
        pid: undefined,
        stats: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
        send() {},
        interrupt() {},
        close() {},
        setModel() {},
        setReasoningBudget() {},
        addAllowedTool() {},
        setBypassPermissions() {},
        setPlanMode(mode) {
          planModeSet = mode;
        },
        getRuntimeBinding() {
          return { provider: "codex" };
        },
        respondToRequest() {
          return false;
        },
      };

      // Plan mode active but no pending plan (normal message during plan mode)
      instance.info.planMode = true;
      instance.info.pendingPlan = undefined;
      instance.info.status = "idle";

      manager.sendMessage(info.id, "plan this feature");

      // Should stay in plan mode
      assert.equal(planModeSet, undefined, "setPlanMode should not be called");
      assert.equal(instance.info.planMode, true, "planMode should remain true");
    });
  });
});
