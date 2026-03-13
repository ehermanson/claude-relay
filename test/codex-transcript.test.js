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
    stats: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costUSD: 0,
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
                input_tokens: 800,
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
      assert.equal(ctx.stats.contextTokens, 800);
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
