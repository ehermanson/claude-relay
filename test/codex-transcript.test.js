import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  convertCodexTranscriptEntry,
  parseCodexTranscript,
  findCodexTranscriptPath,
} from "../dist/core/providers/codex-transcript.js";

function createContext() {
  return {
    pendingCalls: new Map(),
    tasks: new Map(),
    files: new Map(),
    cwd: "/tmp/project",
    stats: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    },
  };
}

describe("convertCodexTranscriptEntry", () => {
  describe("user messages", () => {
    it("converts event_msg user_message to UserMessage", () => {
      const ctx = createContext();
      const results = convertCodexTranscriptEntry(
        {
          type: "event_msg",
          timestamp: "2026-01-01T00:00:00Z",
          payload: { type: "user_message", message: "Hello world" },
        },
        ctx,
      );
      assert.equal(results.length, 1);
      assert.equal(results[0].message.type, "user");
      assert.equal(results[0].message.text, "Hello world");
    });

    it("marks injected task-context prompts as internal", () => {
      const ctx = createContext();
      const results = convertCodexTranscriptEntry(
        {
          type: "event_msg",
          timestamp: "2026-01-01T00:00:00Z",
          payload: {
            type: "user_message",
            message:
              "This project tracks tasks in .relay/tasks.jsonl (append-only JSONL, one JSON object per line). Do not create a task for every request. Create a task only when explicitly asked, pick up an existing task when explicitly asked or when the request clearly matches one, and otherwise just do the work without creating a new task. Ask if unsure whether a request should map to a task. Fields: id (8-char hex), title, description (markdown), status (open|in_progress|done), priority (0-4), type (epic|task|bug), tags (string[]), parent (nullable task ID), blockedBy (task ID[]), createdAt, updatedAt (ISO timestamps). Blocked status is auto-derived from unresolved blockedBy refs. To create: append a new JSON line. To update: append a line with same id and changed fields. When asked to pick up a task (e.g. 'pick up task a1b2c3d4'), read .relay/tasks.jsonl to find it.",
          },
        },
        ctx,
      );
      assert.equal(results.length, 1);
      assert.equal(results[0].message.type, "user");
      assert.equal(results[0].message.internal, true);
    });

    it("skips empty user messages", () => {
      const ctx = createContext();
      const results = convertCodexTranscriptEntry(
        {
          type: "event_msg",
          payload: { type: "user_message", message: "   " },
        },
        ctx,
      );
      assert.equal(results.length, 0);
    });
  });

  describe("agent messages", () => {
    it("converts agent_message to OutputMessage", () => {
      const ctx = createContext();
      const results = convertCodexTranscriptEntry(
        {
          type: "event_msg",
          payload: { type: "agent_message", message: "I'll help with that." },
        },
        ctx,
      );
      assert.equal(results.length, 1);
      assert.equal(results[0].message.type, "output");
      assert.equal(results[0].message.text, "I'll help with that.");
    });

    it("normalizes proposed_plan blocks into ExitPlanMode activity", () => {
      const ctx = createContext();
      const results = convertCodexTranscriptEntry(
        {
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "Intro\n<proposed_plan>\n# Test Plan\n- Step 1\n</proposed_plan>\nOutro",
          },
        },
        ctx,
      );

      assert.equal(results.length, 3);
      assert.equal(results[0].message.type, "output");
      assert.equal(results[0].message.text, "Intro\n");
      assert.equal(results[1].message.type, "activity");
      assert.equal(results[1].message.tool, "ExitPlanMode");
      assert.equal(results[1].message.input.plan, "# Test Plan\n- Step 1");
      assert.equal(results[2].message.type, "output");
      assert.equal(results[2].message.text, "\nOutro");
    });

    it("converts agent_reasoning to thinking activity", () => {
      const ctx = createContext();
      const results = convertCodexTranscriptEntry(
        {
          type: "event_msg",
          payload: { type: "agent_reasoning", text: "Let me think about this..." },
        },
        ctx,
      );
      assert.equal(results.length, 1);
      assert.equal(results[0].message.activity, "thinking");
    });
  });

  describe("function calls and results", () => {
    it("converts function_call to tool_use activity", () => {
      const ctx = createContext();
      const results = convertCodexTranscriptEntry(
        {
          type: "response_item",
          payload: {
            type: "function_call",
            name: "exec_command",
            call_id: "call-1",
            arguments: '{"cmd":"ls -la"}',
          },
        },
        ctx,
      );
      assert.equal(results.length, 1);
      assert.equal(results[0].message.activity, "tool_use");
      assert.equal(results[0].message.tool, "Bash");
      // Should have stored the pending call
      assert.ok(ctx.pendingCalls.has("call-1"));
    });

    it("converts function_call_output to tool_result activity", () => {
      const ctx = createContext();
      ctx.pendingCalls.set("call-1", { name: "exec_command", arguments: '{"cmd":"ls"}' });

      const results = convertCodexTranscriptEntry(
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call-1",
            output: "file1.txt\nfile2.txt",
          },
        },
        ctx,
      );
      assert.equal(results.length, 1);
      assert.equal(results[0].message.activity, "tool_result");
      assert.equal(results[0].message.tool, "Bash");
      // Pending call should be cleared
      assert.ok(!ctx.pendingCalls.has("call-1"));
    });

    it("detects failed exec_command from exit code", () => {
      const ctx = createContext();
      ctx.pendingCalls.set("call-1", { name: "exec_command", arguments: '{"cmd":"false"}' });

      const results = convertCodexTranscriptEntry(
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call-1",
            output: "Process exited with code 1",
          },
        },
        ctx,
      );
      assert.equal(results[0].message.description, "Command failed");
    });

    it("normalizes request_user_input into AskUserQuestion activities", () => {
      const ctx = createContext();
      const promptResults = convertCodexTranscriptEntry(
        {
          type: "response_item",
          payload: {
            type: "function_call",
            name: "request_user_input",
            call_id: "ask-1",
            arguments:
              '{"questions":[{"id":"color","header":"Palette","question":"Pick a color","options":[{"label":"Blue","description":"Recommended"}]}]}',
          },
        },
        ctx,
      );

      assert.equal(promptResults.length, 1);
      assert.equal(promptResults[0].message.tool, "AskUserQuestion");
      assert.equal(promptResults[0].message.description, "Question");
      assert.equal(promptResults[0].message.inputDescription, "Pick a color");

      const resultResults = convertCodexTranscriptEntry(
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "ask-1",
            output: '{"answers":{"color":{"answers":["Blue"]}}}',
          },
        },
        ctx,
      );

      assert.equal(resultResults.length, 1);
      assert.equal(resultResults[0].message.tool, "AskUserQuestion");
      assert.equal(resultResults[0].message.resolution, "approved");
    });
  });

  describe("apply_patch file tracking", () => {
    it("extracts added files from patch input", () => {
      const ctx = createContext();
      const patch = `*** Add File: src/new.ts
+console.log("hello");`;

      convertCodexTranscriptEntry(
        {
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            name: "apply_patch",
            call_id: "p1",
            input: patch,
          },
        },
        ctx,
      );
      assert.ok(ctx.files.has("src/new.ts"));
      assert.equal(ctx.files.get("src/new.ts").type, "added");
    });

    it("extracts updated files from patch input", () => {
      const ctx = createContext();
      const patch = `*** Update File: src/existing.ts
@@ -1,3 +1,3 @@
-old line
+new line`;

      convertCodexTranscriptEntry(
        {
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            name: "apply_patch",
            call_id: "p2",
            input: patch,
          },
        },
        ctx,
      );
      assert.ok(ctx.files.has("src/existing.ts"));
      assert.equal(ctx.files.get("src/existing.ts").type, "edited");
    });

    it("ignores apply_patch changes outside the current workspace", () => {
      const ctx = createContext();
      const patch = `*** Update File: /Users/test/.claude/plans/session-plan.md
@@ -1,3 +1,3 @@
-old line
+new line`;

      convertCodexTranscriptEntry(
        {
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            name: "apply_patch",
            call_id: "p3",
            input: patch,
          },
        },
        ctx,
      );

      assert.equal(ctx.files.size, 0);
    });
  });

  describe("token tracking", () => {
    it("accumulates token counts from token_count events", () => {
      const ctx = createContext();
      convertCodexTranscriptEntry(
        {
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 1000,
                output_tokens: 500,
                cached_input_tokens: 200,
              },
              last_token_usage: {
                total_tokens: 1000,
                input_tokens: 800,
                cached_input_tokens: 200,
              },
              model_context_window: 128000,
            },
          },
        },
        ctx,
      );
      assert.equal(ctx.stats.inputTokens, 1000);
      assert.equal(ctx.stats.outputTokens, 500);
      assert.equal(ctx.stats.cacheReadTokens, 200);
      assert.equal(ctx.stats.contextTokens, 1000);
      assert.equal(ctx.stats.contextWindow, 128000);
    });

    it("captures model from turn_context event", () => {
      const ctx = createContext();
      convertCodexTranscriptEntry(
        {
          type: "event_msg",
          payload: { type: "turn_context", model: "gpt-5.3-codex" },
        },
        ctx,
      );
      assert.equal(ctx.stats.model, "gpt-5.3-codex");
    });

    it("captures model from top-level turn_context entry", () => {
      const ctx = createContext();
      convertCodexTranscriptEntry(
        {
          type: "turn_context",
          payload: { model: "gpt-5.4" },
        },
        ctx,
      );
      assert.equal(ctx.stats.model, "gpt-5.4");
    });
  });

  describe("plan updates", () => {
    it("suppresses update_plan tool results", () => {
      const ctx = createContext();
      ctx.pendingCalls.set("plan-1", { name: "update_plan" });

      const results = convertCodexTranscriptEntry(
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "plan-1",
            output: "Plan updated",
          },
        },
        ctx,
      );
      assert.equal(results.length, 0);
    });
  });

  describe("edge cases", () => {
    it("handles missing payload gracefully", () => {
      const ctx = createContext();
      const results = convertCodexTranscriptEntry({ type: "response_item" }, ctx);
      assert.equal(results.length, 0);
    });

    it("handles unknown event types gracefully", () => {
      const ctx = createContext();
      const results = convertCodexTranscriptEntry({ type: "unknown_type", payload: {} }, ctx);
      assert.equal(results.length, 0);
    });

    it("uses current time for missing timestamps", () => {
      const ctx = createContext();
      const before = Date.now();
      const results = convertCodexTranscriptEntry(
        {
          type: "event_msg",
          payload: { type: "user_message", message: "hi" },
        },
        ctx,
      );
      const after = Date.now();
      assert.ok(results[0].timestamp >= before && results[0].timestamp <= after);
    });
  });
});

describe("parseCodexTranscript", () => {
  it("parses a full transcript file", () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-codex-"));
    const filePath = join(dir, "transcript.jsonl");
    const lines = [
      JSON.stringify({
        type: "session_meta",
        payload: { id: "sess-1", cwd: "/home/user/project" },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-01-01T00:00:00Z",
        payload: { type: "user_message", message: "Fix the bug" },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-01-01T00:00:01Z",
        payload: { type: "agent_message", message: "I'll fix it." },
      }),
    ];
    writeFileSync(filePath, lines.join("\n"));

    try {
      const result = parseCodexTranscript(filePath);
      assert.equal(result.cwd, "/home/user/project");
      assert.equal(result.history.length, 2);
      assert.equal(result.history[0].message.type, "user");
      assert.equal(result.history[1].message.type, "output");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marks injected task-context prompts as internal when parsing a full transcript", () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-codex-"));
    const filePath = join(dir, "transcript.jsonl");
    const lines = [
      JSON.stringify({
        type: "session_meta",
        payload: { id: "sess-1", cwd: "/home/user/project" },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-01-01T00:00:00Z",
        payload: {
          type: "user_message",
          message:
            "This project tracks tasks in .relay/tasks.jsonl (append-only JSONL, one JSON object per line). Do not create a task for every request. Create a task only when explicitly asked, pick up an existing task when explicitly asked or when the request clearly matches one, and otherwise just do the work without creating a new task. Ask if unsure whether a request should map to a task. Fields: id (8-char hex), title, description (markdown), status (open|in_progress|done), priority (0-4), type (epic|task|bug), tags (string[]), parent (nullable task ID), blockedBy (task ID[]), createdAt, updatedAt (ISO timestamps). Blocked status is auto-derived from unresolved blockedBy refs. To create: append a new JSON line. To update: append a line with same id and changed fields. When asked to pick up a task (e.g. 'pick up task a1b2c3d4'), read .relay/tasks.jsonl to find it.",
        },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-01-01T00:00:01Z",
        payload: { type: "agent_message", message: "I'll help with that." },
      }),
    ];
    writeFileSync(filePath, lines.join("\n"));

    try {
      const result = parseCodexTranscript(filePath);
      assert.equal(result.history.length, 2);
      assert.equal(result.history[0].message.type, "user");
      assert.equal(result.history[0].message.internal, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty result for nonexistent file", () => {
    const result = parseCodexTranscript("/nonexistent/file.jsonl");
    assert.equal(result.cwd, "");
    assert.equal(result.history.length, 0);
  });

  it("skips malformed lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-codex-"));
    const filePath = join(dir, "bad.jsonl");
    writeFileSync(
      filePath,
      [
        "not json",
        JSON.stringify({
          type: "event_msg",
          payload: { type: "user_message", message: "valid" },
        }),
        "{broken json",
      ].join("\n"),
    );

    try {
      const result = parseCodexTranscript(filePath);
      assert.equal(result.history.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("findCodexTranscriptPath", () => {
  it("finds a transcript by session ID in the filename", () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-codex-find-"));
    const sessionsDir = join(dir, "sessions", "2026", "01", "01");
    mkdirSync(sessionsDir, { recursive: true });
    const filePath = join(sessionsDir, "sess-abc123.jsonl");
    writeFileSync(
      filePath,
      JSON.stringify({ type: "session_meta", payload: { id: "sess-abc123" } }),
    );

    try {
      const found = findCodexTranscriptPath(dir, "sess-abc123");
      assert.equal(found, filePath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined when session ID not found", () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-codex-find-"));
    mkdirSync(join(dir, "sessions"), { recursive: true });

    try {
      const found = findCodexTranscriptPath(dir, "nonexistent");
      assert.equal(found, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined when sessions dir doesn't exist", () => {
    const found = findCodexTranscriptPath("/nonexistent", "sess-1");
    assert.equal(found, undefined);
  });
});
