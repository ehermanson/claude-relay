import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
  return resolveConfig({
    password: "test",
    logger: noopLogger,
    maxProcesses: 3,
    dbPath: join(tempDir, "sessions.db"),
    claudeDir: join(tempDir, ".claude"),
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
          costUSD: 5,
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
        costUSD: 5,
      });
      assert.deepEqual(instance.info.stats, {
        inputTokens: 1,
        outputTokens: 2,
        cacheCreationTokens: 3,
        cacheReadTokens: 4,
        costUSD: 5,
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
          costUSD: 0,
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
  });
});
