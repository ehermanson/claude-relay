/**
 * Tests for JSONL → history conversion via the DB restore path.
 * This tests parseJsonl + convertJsonlEntry indirectly by restoring
 * external instances from the SQLite DB and verifying their history content.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InstanceManager } from "../dist/core/instance-manager.js";
import { SessionDB } from "../dist/core/db.js";
import { resolveConfig } from "../dist/server/config.js";

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

const fixturesDir = join(import.meta.dirname, "fixtures");

function makeManager(tempDir, overrides = {}) {
  const config = resolveConfig({
    password: "test",
    logger: noopLogger,
    maxProcesses: 20,
    dbPath: join(tempDir, "sessions.db"),
    claudeDir: join(tempDir, ".claude"),
    codexDir: join(tempDir, ".codex"),
    ...overrides,
  });
  return new InstanceManager(config);
}

function seedDB(tempDir, entries) {
  const dbPath = join(tempDir, "sessions.db");
  const db = new SessionDB(dbPath, noopLogger);
  for (const entry of entries) {
    db.upsert({
      session_id: entry.sessionId || "test-session",
      instance_id: entry.id || "test-id",
      provider_name: "claude",
      name: entry.name || "Test Session",
      working_directory: entry.workingDirectory || "/Users/test/projects/my-app",
      jsonl_path: entry.jsonlPath,
      created_at: entry.createdAt || Date.now(),
      last_activity_at: entry.lastActivityAt || entry.createdAt || Date.now(),
      type: entry.type || "external",
      archived: 0,
      custom_title: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      cost_usd: 0,
      summary: null,
      first_prompt: null,
      git_branch: null,
      message_count: 0,
      allowed_tools: "[]",
      worktree_path: null,
      original_directory: null,
      parent_session_id: null,
      preferred_model: null,
      reasoning_budget: null,
      skip_permissions: 0,
      last_message_text: entry.lastMessageText || null,
      last_message_from: entry.lastMessageFrom || null,
      last_message_at: entry.lastMessageAt || null,
      git_info_branch: entry.gitInfoBranch || null,
      git_info_is_worktree:
        entry.gitInfoIsWorktree === undefined ? null : entry.gitInfoIsWorktree ? 1 : 0,
    });
  }
  db.close();
}

function makeExternalEntry(overrides) {
  return {
    id: "test-id",
    name: "Test Session",
    workingDirectory: "/Users/test/projects/my-app",
    sessionId: "test-session",
    createdAt: Date.now(),
    type: "external",
    ...overrides,
  };
}

function seedManagedDB(tempDir, entries) {
  const dbPath = join(tempDir, "sessions.db");
  const db = new SessionDB(dbPath, noopLogger);
  for (const entry of entries) {
    db.upsertManaged({
      instance_id: entry.id || "managed-id",
      provider_name: entry.provider || "codex",
      provider_session_id: entry.providerSessionId || null,
      name: entry.name || "Managed Session",
      working_directory: entry.workingDirectory || "/Users/test/projects/my-app",
      created_at: entry.createdAt || Date.now(),
      last_activity_at: entry.lastActivityAt || entry.createdAt || Date.now(),
      archived: 0,
      custom_title: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      cost_usd: 0,
      git_branch: null,
      worktree_path: null,
      original_directory: null,
      parent_session_id: null,
      preferred_model: entry.preferredModel || null,
      reasoning_budget: null,
      skip_permissions: 0,
      runtime_mode: "approval-required",
      resume_cursor_json: entry.resumeCursorJson || null,
      runtime_payload_json:
        entry.runtimePayloadJson ||
        JSON.stringify({ cwd: entry.workingDirectory || "/Users/test/projects/my-app" }),
      transcript_path: entry.transcriptPath || null,
      last_message_text: entry.lastMessageText || null,
      last_message_from: entry.lastMessageFrom || null,
      last_message_at: entry.lastMessageAt || null,
      git_info_branch: entry.gitInfoBranch || null,
      git_info_is_worktree:
        entry.gitInfoIsWorktree === undefined ? null : entry.gitInfoIsWorktree ? 1 : 0,
    });
  }
  db.close();
}

describe("History Parsing via DB Restore", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "relay-history-test-"));
  });

  afterEach(() => {
    // Clean up any managers
  });

  describe("basic session history", () => {
    it("restores user and assistant messages from JSONL", () => {
      seedDB(tempDir, [makeExternalEntry({ jsonlPath: join(fixturesDir, "basic-session.jsonl") })]);
      const manager = makeManager(tempDir);
      manager.restoreInstances();

      const history = manager.getHistory("test-id");
      assert.ok(history.length > 0, "History should not be empty");

      // Find user messages
      const userMessages = history.filter((h) => h.message.type === "user");
      assert.ok(
        userMessages.length >= 2,
        `Expected at least 2 user messages, got ${userMessages.length}`,
      );
      assert.equal(userMessages[0].message.text, "Hello, can you help me with this project?");

      // Find output messages (assistant text)
      const outputMessages = history.filter(
        (h) => h.message.type === "output" && h.message.text && !h.message.isWaiting,
      );
      assert.ok(
        outputMessages.length >= 1,
        `Expected at least 1 output message, got ${outputMessages.length}`,
      );

      manager.stopAll();
    });

    it("extracts timestamps from JSONL entries", () => {
      seedDB(tempDir, [makeExternalEntry({ jsonlPath: join(fixturesDir, "basic-session.jsonl") })]);
      const manager = makeManager(tempDir);
      manager.restoreInstances();

      const history = manager.getHistory("test-id");
      for (const entry of history) {
        assert.equal(typeof entry.timestamp, "number");
        assert.ok(!isNaN(entry.timestamp), "Timestamp should not be NaN");
        assert.ok(entry.timestamp > 0, "Timestamp should be positive");
      }

      manager.stopAll();
    });
  });

  describe("compact boundary handling", () => {
    it("discards history before compact boundary", () => {
      seedDB(tempDir, [
        makeExternalEntry({ jsonlPath: join(fixturesDir, "compact-session.jsonl") }),
      ]);
      const manager = makeManager(tempDir);
      manager.restoreInstances();

      const history = manager.getHistory("test-id");
      const userMessages = history.filter((h) => h.message.type === "user");

      // Only the user message AFTER compact boundary should remain
      // "First message before compact" should be gone
      // "Second message after compact" should be present
      const texts = userMessages.map((h) => h.message.text);
      assert.ok(
        !texts.includes("First message before compact"),
        "Pre-compact message should be discarded",
      );
      assert.ok(
        texts.includes("Second message after compact"),
        "Post-compact message should be present",
      );

      manager.stopAll();
    });
  });

  describe("tool use history", () => {
    it("converts thinking blocks to activity messages", () => {
      seedDB(tempDir, [
        makeExternalEntry({ jsonlPath: join(fixturesDir, "tool-use-session.jsonl") }),
      ]);
      const manager = makeManager(tempDir);
      manager.restoreInstances();

      const history = manager.getHistory("test-id");
      const thinkingActivities = history.filter(
        (h) => h.message.type === "activity" && h.message.activity === "thinking",
      );
      assert.ok(thinkingActivities.length >= 1, "Should have at least one thinking activity");
      assert.equal(thinkingActivities[0].message.description, "Reasoning...");

      manager.stopAll();
    });

    it("converts tool_use blocks to activity messages", () => {
      seedDB(tempDir, [
        makeExternalEntry({ jsonlPath: join(fixturesDir, "tool-use-session.jsonl") }),
      ]);
      const manager = makeManager(tempDir);
      manager.restoreInstances();

      const history = manager.getHistory("test-id");
      const toolUseActivities = history.filter(
        (h) => h.message.type === "activity" && h.message.activity === "tool_use",
      );
      assert.ok(toolUseActivities.length >= 1, "Should have at least one tool_use activity");
      assert.equal(toolUseActivities[0].message.tool, "Bash");
      assert.equal(toolUseActivities[0].message.description, "Running command");

      manager.stopAll();
    });

    it("converts tool_result blocks to activity messages", () => {
      seedDB(tempDir, [
        makeExternalEntry({ jsonlPath: join(fixturesDir, "tool-use-session.jsonl") }),
      ]);
      const manager = makeManager(tempDir);
      manager.restoreInstances();

      const history = manager.getHistory("test-id");
      const toolResultActivities = history.filter(
        (h) => h.message.type === "activity" && h.message.activity === "tool_result",
      );
      assert.ok(toolResultActivities.length >= 1, "Should have at least one tool_result activity");
      assert.equal(toolResultActivities[0].message.description, "Tool completed");

      manager.stopAll();
    });
  });

  describe("permission denial", () => {
    it("detects permission denial in tool_result", () => {
      seedDB(tempDir, [
        makeExternalEntry({ jsonlPath: join(fixturesDir, "permission-denied-session.jsonl") }),
      ]);
      const manager = makeManager(tempDir);
      manager.restoreInstances();

      const history = manager.getHistory("test-id");
      const denials = history.filter(
        (h) =>
          h.message.type === "activity" &&
          h.message.activity === "tool_result" &&
          h.message.permissionDenied,
      );
      assert.ok(denials.length >= 1, "Should have at least one permission denial");
      assert.equal(denials[0].message.description, "Permission denied");
      assert.equal(denials[0].message.permissionDenied, "Bash");

      manager.stopAll();
    });
  });

  describe("internal tag stripping", () => {
    it("strips system-reminder tags from user messages", () => {
      seedDB(tempDir, [
        makeExternalEntry({ jsonlPath: join(fixturesDir, "internal-tags-session.jsonl") }),
      ]);
      const manager = makeManager(tempDir);
      manager.restoreInstances();

      const history = manager.getHistory("test-id");
      const userMessages = history.filter((h) => h.message.type === "user");
      assert.ok(userMessages.length >= 1);

      // The system-reminder tag should be stripped, leaving only "Hello there!"
      const text = userMessages[0].message.text;
      assert.ok(!text.includes("<system-reminder>"), "System reminder tag should be stripped");
      assert.ok(text.includes("Hello there!"), "Actual message content should remain");

      manager.stopAll();
    });
  });

  describe("image handling", () => {
    it("converts image blocks to [Image: source: path] format", () => {
      seedDB(tempDir, [makeExternalEntry({ jsonlPath: join(fixturesDir, "image-session.jsonl") })]);
      const manager = makeManager(tempDir);
      manager.restoreInstances();

      const history = manager.getHistory("test-id");
      const userMessages = history.filter((h) => h.message.type === "user");
      assert.ok(userMessages.length >= 1);

      // Should contain [Image: source: /path] AND the text question
      const text = userMessages[0].message.text;
      assert.ok(
        text.includes("[Image: source: /Users/test/screenshot.png]"),
        "Should include image reference",
      );
      assert.ok(text.includes("What do you see in this image?"), "Should include text content");

      manager.stopAll();
    });
  });

  describe("missing timestamps", () => {
    it("falls back to Date.now() for entries without timestamps", () => {
      seedDB(tempDir, [
        makeExternalEntry({ jsonlPath: join(fixturesDir, "no-timestamp-session.jsonl") }),
      ]);
      const manager = makeManager(tempDir);
      manager.restoreInstances();

      const history = manager.getHistory("test-id");
      assert.ok(history.length > 0, "History should not be empty");

      const now = Date.now();
      for (const entry of history) {
        assert.ok(!isNaN(entry.timestamp), "Timestamp should not be NaN");
        // Timestamps should be recent (within last 5 seconds)
        assert.ok(
          Math.abs(now - entry.timestamp) < 5000,
          "Fallback timestamp should be close to current time",
        );
      }

      manager.stopAll();
    });
  });

  describe("lastMessage preview", () => {
    it("restores sidebar preview metadata from the database before hydration", () => {
      const lastMessageAt = Date.now() - 60_000;
      seedDB(tempDir, [
        makeExternalEntry({
          jsonlPath: join(fixturesDir, "basic-session.jsonl"),
          lastMessageText: "Persisted preview",
          lastMessageFrom: "user",
          lastMessageAt,
          gitInfoBranch: "main",
          gitInfoIsWorktree: false,
        }),
      ]);
      const manager = makeManager(tempDir);
      manager.restoreInstances();

      const info = manager.getInstance("test-id");
      assert.ok(info.lastMessage, "Should have lastMessage");
      assert.equal(info.lastMessage.text, "Persisted preview");
      assert.equal(info.lastMessage.from, "user");
      assert.equal(info.lastMessage.timestamp, lastMessageAt);
      assert.deepEqual(info.gitInfo, { branch: "main", isWorktree: false });

      manager.stopAll();
    });
  });

  describe("managed Codex restore", () => {
    it("rehydrates history and stats from a persisted Codex transcript on first open", () => {
      const transcriptPath = join(fixturesDir, "codex-managed-session.jsonl");
      seedManagedDB(tempDir, [
        {
          id: "codex-managed-id",
          provider: "codex",
          providerSessionId: "codex-test-session",
          name: "Codex Session",
          workingDirectory: "/Users/test/projects/my-app",
          transcriptPath,
          preferredModel: "gpt-5.4",
          resumeCursorJson: JSON.stringify({ sessionId: "codex-test-session" }),
        },
      ]);

      const manager = makeManager(tempDir);
      manager.restoreInstances();

      const infoBefore = manager.getInstance("codex-managed-id");
      const instanceBefore = manager.instances.get("codex-managed-id");
      assert.equal(infoBefore.provider, "codex");
      assert.equal(infoBefore.sessionId, "codex-test-session");
      assert.equal(infoBefore.status, "stopped");
      assert.equal(instanceBefore.process, null);

      const history = manager.getHistory("codex-managed-id");
      const info = manager.getInstance("codex-managed-id");

      assert.equal(info.status, "idle");
      assert.ok(info.stats, "Managed Codex session should restore stats");
      assert.equal(info.stats.inputTokens, 120);
      assert.equal(info.stats.cacheReadTokens, 45);
      assert.equal(info.stats.outputTokens, 30);
      assert.equal(info.stats.model, "gpt-5.4");
      assert.equal(manager.instances.get("codex-managed-id").process?.provider, "codex");

      const userMessages = history.filter((h) => h.message.type === "user");
      assert.equal(userMessages.length, 1, "Only the actual chat message should be replayed");
      assert.equal(userMessages[0].message.text, "How do I build this?");

      const toolUse = history.find(
        (h) => h.message.type === "activity" && h.message.activity === "tool_use",
      );
      assert.ok(toolUse, "Expected a restored tool_use activity");
      assert.equal(toolUse.message.tool, "Bash");
      assert.equal(toolUse.message.description, "Running command");

      const toolResult = history.find(
        (h) => h.message.type === "activity" && h.message.activity === "tool_result",
      );
      assert.ok(toolResult, "Expected a restored tool_result activity");
      assert.equal(toolResult.message.description, "Command completed");

      manager.stopAll();
    });

    it("discovers the Codex transcript path from the provider session id on restore", () => {
      const codexSessionDir = join(tempDir, ".codex", "sessions", "2026", "03", "08");
      mkdirSync(codexSessionDir, { recursive: true });
      const transcriptPath = join(
        codexSessionDir,
        "rollout-2026-03-08T12-00-00-codex-test-session.jsonl",
      );
      writeFileSync(transcriptPath, readFileSync(join(fixturesDir, "codex-managed-session.jsonl")));

      seedManagedDB(tempDir, [
        {
          id: "codex-discovery-id",
          provider: "codex",
          providerSessionId: "codex-test-session",
          name: "Recovered Codex Session",
          workingDirectory: "/Users/test/projects/my-app",
          resumeCursorJson: JSON.stringify({ sessionId: "codex-test-session" }),
        },
      ]);

      const manager = makeManager(tempDir);
      manager.restoreInstances();

      const history = manager.getHistory("codex-discovery-id");
      assert.ok(history.length > 0, "Managed Codex restore should discover transcript history");

      const db = new SessionDB(join(tempDir, "sessions.db"), noopLogger);
      const row = db.getManagedByInstanceId("codex-discovery-id");
      assert.ok(row, "Expected managed Codex row to persist");
      assert.equal(row.transcript_path, transcriptPath);
      db.close();

      manager.stopAll();
    });

    it("rebuilds changed files from Codex apply_patch transcript entries", () => {
      const transcriptPath = join(tempDir, "codex-files-session.jsonl");
      writeFileSync(
        transcriptPath,
        [
          JSON.stringify({
            timestamp: "2026-03-08T12:00:00.000Z",
            type: "session_meta",
            payload: {
              id: "codex-files-session",
              timestamp: "2026-03-08T12:00:00.000Z",
              cwd: "/Users/test/projects/my-app",
              originator: "codex_exec",
              source: "exec",
              model_provider: "openai",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-08T12:00:01.000Z",
            type: "response_item",
            payload: {
              type: "custom_tool_call",
              name: "apply_patch",
              call_id: "call-patch",
              input: "*** Begin Patch\n*** Update File: src/app.ts\n@@\n*** End Patch\n",
            },
          }),
          JSON.stringify({
            timestamp: "2026-03-08T12:00:01.050Z",
            type: "response_item",
            payload: {
              type: "custom_tool_call_output",
              call_id: "call-patch",
              output: '{"output":"Success. Updated the following files:\\nM src/app.ts\\n"}',
            },
          }),
          "",
        ].join("\n"),
      );

      seedManagedDB(tempDir, [
        {
          id: "codex-files-id",
          provider: "codex",
          providerSessionId: "codex-files-session",
          name: "Codex Files Session",
          workingDirectory: "/Users/test/projects/my-app",
          transcriptPath,
          resumeCursorJson: JSON.stringify({ sessionId: "codex-files-session" }),
        },
      ]);

      const manager = makeManager(tempDir);
      manager.restoreInstances();

      manager.getHistory("codex-files-id");
      const instance = manager.instances.get("codex-files-id");
      assert.deepEqual(Array.from(instance.files.values()), [
        { path: "src/app.ts", editCount: 1, type: "edited" },
      ]);

      manager.stopAll();
    });

    it("archives incomplete managed rows that have no resumable binding", () => {
      seedManagedDB(tempDir, [
        {
          id: "empty-managed-id",
          provider: "claude",
          name: "Normal",
          workingDirectory: "/Users/test/projects/my-app",
          providerSessionId: null,
          resumeCursorJson: null,
          runtimePayloadJson: JSON.stringify({ cwd: "/Users/test/projects/my-app" }),
          transcriptPath: null,
        },
      ]);

      const manager = makeManager(tempDir);
      manager.restoreInstances();

      assert.equal(manager.listInstances().length, 0);

      const db = new SessionDB(join(tempDir, "sessions.db"), noopLogger);
      try {
        const row = db.getManagedByInstanceId("empty-managed-id");
        assert.ok(row, "Expected placeholder row to remain in DB");
        assert.equal(row.archived, 1, "Incomplete managed row should be archived");
      } finally {
        db.close();
      }

      manager.stopAll();
    });
  });

  describe("malformed JSONL handling", () => {
    it("skips malformed lines without crashing", () => {
      const jsonlPath = join(tempDir, "malformed.jsonl");
      writeFileSync(
        jsonlPath,
        [
          '{"type":"system","subtype":"init","cwd":"/tmp/test","timestamp":"2026-02-10T10:00:00.000Z"}',
          "this is not json",
          '{"type":"user","message":{"role":"user","content":"Hello"},"timestamp":"2026-02-10T10:00:01.000Z"}',
          "{incomplete json...",
          '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hi!"}]},"timestamp":"2026-02-10T10:00:02.000Z"}',
        ].join("\n"),
      );

      seedDB(tempDir, [makeExternalEntry({ jsonlPath })]);
      const manager = makeManager(tempDir);
      manager.restoreInstances();

      const history = manager.getHistory("test-id");
      // Should have parsed the valid lines, skipping malformed ones
      const userMessages = history.filter((h) => h.message.type === "user");
      assert.ok(userMessages.length >= 1, "Should have parsed the valid user message");

      manager.stopAll();
    });

    it("handles empty JSONL file", () => {
      const jsonlPath = join(tempDir, "empty.jsonl");
      writeFileSync(jsonlPath, "");

      seedDB(tempDir, [makeExternalEntry({ jsonlPath })]);
      const manager = makeManager(tempDir);
      manager.restoreInstances();

      const history = manager.getHistory("test-id");
      assert.equal(history.length, 0, "Empty JSONL should produce empty history");

      manager.stopAll();
    });
  });

  describe("MAX_HISTORY cap", () => {
    it("caps history at 1000 entries", () => {
      // Create a JSONL with > 1000 entries
      const jsonlPath = join(tempDir, "large.jsonl");
      const lines = [
        '{"type":"system","subtype":"init","cwd":"/tmp/test","timestamp":"2026-02-10T10:00:00.000Z"}',
      ];
      for (let i = 0; i < 600; i++) {
        lines.push(
          JSON.stringify({
            type: "user",
            message: { role: "user", content: `Message ${i}` },
            timestamp: `2026-02-10T10:${String(i % 60).padStart(2, "0")}:${String(Math.floor(i / 60)).padStart(2, "0")}.000Z`,
          }),
        );
        lines.push(
          JSON.stringify({
            type: "assistant",
            message: { role: "assistant", content: [{ type: "text", text: `Reply ${i}` }] },
            timestamp: `2026-02-10T10:${String(i % 60).padStart(2, "0")}:${String(Math.floor(i / 60)).padStart(2, "0")}.500Z`,
          }),
        );
      }
      writeFileSync(jsonlPath, lines.join("\n"));

      seedDB(tempDir, [makeExternalEntry({ jsonlPath })]);
      const manager = makeManager(tempDir);
      manager.restoreInstances();

      const history = manager.getHistory("test-id");
      assert.ok(history.length <= 1000, `History should be capped at 1000, got ${history.length}`);

      manager.stopAll();
    });
  });

  describe("event emission on restore", () => {
    it("emits instance:created for restored instances", () => {
      seedDB(tempDir, [makeExternalEntry({ jsonlPath: join(fixturesDir, "basic-session.jsonl") })]);
      const manager = makeManager(tempDir);

      const events = [];
      manager.on("instance:created", (id, info) => {
        events.push({ id, info });
      });

      manager.restoreInstances();

      assert.equal(events.length, 1);
      assert.equal(events[0].id, "test-id");
      assert.equal(events[0].info.name, "Test Session");

      manager.stopAll();
    });
  });
});
