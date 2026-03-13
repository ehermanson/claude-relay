import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSdkSession, createSdkSessionSync } from "../dist/core/providers/claude-sdk.js";

// =============================================================================
// FakeQuery — mirrors the SDK's Query async generator + control methods
// =============================================================================

class FakeQuery {
  constructor() {
    this.queue = [];
    this.resolvers = [];
    this.done = false;
    this.interruptCalls = 0;
    this.setPermissionModeCalls = [];
    this.setModelCalls = [];
    this.setMaxThinkingTokensCalls = [];
    this.closeCalls = 0;
  }

  emit(message) {
    if (this.done) return;
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ done: false, value: message });
    } else {
      this.queue.push(message);
    }
  }

  finish() {
    if (this.done) return;
    this.done = true;
    for (const resolver of this.resolvers.splice(0)) {
      resolver({ done: true, value: undefined });
    }
  }

  async interrupt() {
    this.interruptCalls++;
  }

  async setPermissionMode(mode) {
    this.setPermissionModeCalls.push(mode);
  }

  async setModel(model) {
    this.setModelCalls.push(model);
  }

  async setMaxThinkingTokens(maxThinkingTokens) {
    this.setMaxThinkingTokensCalls.push(maxThinkingTokens);
  }

  close() {
    this.closeCalls++;
    this.finish();
  }

  [Symbol.asyncIterator]() {
    const self = this;
    return {
      next() {
        const queued = self.queue.shift();
        if (queued) return Promise.resolve({ done: false, value: queued });
        if (self.done) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => {
          self.resolvers.push(resolve);
        });
      },
    };
  }
}

// =============================================================================
// Helpers
// =============================================================================

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

function makeHarness() {
  const fakeQuery = new FakeQuery();
  /** @type {any} */
  let capturedPrompt;

  const queryFn = ({ prompt, options }) => {
    capturedPrompt = prompt;
    return fakeQuery;
  };

  return {
    fakeQuery,
    queryFn,
    getCapturedPrompt: () => capturedPrompt,
  };
}

async function createTestSession(harness, overrides = {}) {
  return createSdkSession({
    cwd: "/test/project",
    logger: noopLogger,
    queryFn: harness.queryFn,
    ...overrides,
  });
}

/** Collect events of a given type from the session */
function collectEvents(session, eventName) {
  const events = [];
  session.on(eventName, (...args) => events.push(args));
  return events;
}

/** Wait for a short time to let async operations settle */
function tick(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Tests
// =============================================================================

describe("ClaudeSdkSession", () => {
  describe("creation", () => {
    it("creates a session with injected queryFn", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);
      assert.ok(session);
      assert.equal(session.isProcessing, false);
      assert.equal(session.pid, undefined);
      assert.equal(session.sessionId, undefined);
      session.close();
    });

    it("passes cwd and model to SDK options", async () => {
      let capturedOptions;
      const fakeQuery = new FakeQuery();
      const session = await createSdkSession({
        cwd: "/my/project",
        model: "claude-opus-4-6",
        logger: noopLogger,
        queryFn: ({ prompt, options }) => {
          capturedOptions = options;
          return fakeQuery;
        },
      });
      assert.equal(capturedOptions.cwd, "/my/project");
      assert.equal(capturedOptions.model, "claude-opus-4-6");
      assert.equal(capturedOptions.includePartialMessages, true);
      session.close();
    });

    it("passes maxThinkingTokens to SDK options", async () => {
      let capturedOptions;
      const fakeQuery = new FakeQuery();
      const session = await createSdkSession({
        cwd: "/my/project",
        maxThinkingTokens: 10000,
        logger: noopLogger,
        queryFn: ({ prompt, options }) => {
          capturedOptions = options;
          return fakeQuery;
        },
      });
      assert.equal(capturedOptions.maxThinkingTokens, 10000);
      session.close();
    });

    it("passes resume option when resumeSessionId is set", async () => {
      let capturedOptions;
      const fakeQuery = new FakeQuery();
      const session = await createSdkSession({
        cwd: "/test",
        resumeSessionId: "abc-123",
        logger: noopLogger,
        queryFn: ({ prompt, options }) => {
          capturedOptions = options;
          return fakeQuery;
        },
      });
      assert.equal(capturedOptions.resume, "abc-123");
      session.close();
    });

    it("always sets canUseTool for runtime toggle support", async () => {
      let capturedOptions;
      const fakeQuery = new FakeQuery();
      const session = await createSdkSession({
        cwd: "/test",
        dangerouslySkipPermissions: true,
        logger: noopLogger,
        queryFn: ({ prompt, options }) => {
          capturedOptions = options;
          return fakeQuery;
        },
      });
      // canUseTool is always set (auto-approves when bypass is on)
      assert.ok(typeof capturedOptions.canUseTool === "function");
      assert.equal(capturedOptions.permissionMode, "bypassPermissions");
      session.close();
    });

    it("passes plan permission mode when requested", async () => {
      let capturedOptions;
      const fakeQuery = new FakeQuery();
      const session = await createSdkSession({
        cwd: "/test",
        planMode: true,
        logger: noopLogger,
        queryFn: ({ prompt, options }) => {
          capturedOptions = options;
          return fakeQuery;
        },
      });
      assert.equal(capturedOptions.permissionMode, "plan");
      session.close();
    });

    it("sets canUseTool when dangerouslySkipPermissions is false", async () => {
      let capturedOptions;
      const fakeQuery = new FakeQuery();
      const session = await createSdkSession({
        cwd: "/test",
        logger: noopLogger,
        queryFn: ({ prompt, options }) => {
          capturedOptions = options;
          return fakeQuery;
        },
      });
      assert.ok(typeof capturedOptions.canUseTool === "function");
      session.close();
    });

    it("passes pre-approved allowedTools", async () => {
      let capturedOptions;
      const fakeQuery = new FakeQuery();
      const session = await createSdkSession({
        cwd: "/test",
        allowedTools: ["Bash", "Edit"],
        logger: noopLogger,
        queryFn: ({ prompt, options }) => {
          capturedOptions = options;
          return fakeQuery;
        },
      });
      assert.deepEqual(capturedOptions.allowedTools, ["Bash", "Edit"]);
      session.close();
    });
  });

  describe("send()", () => {
    it("pushes a user message to the prompt queue", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);

      session.send("Hello Claude");
      assert.equal(session.isProcessing, true);

      // Read from the prompt queue
      const prompt = harness.getCapturedPrompt();
      const iter = prompt[Symbol.asyncIterator]();
      const { value } = await iter.next();
      assert.equal(value.type, "user");
      assert.equal(value.message.content[0].text, "Hello Claude");

      session.close();
    });

    it("rejects sends while processing", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);

      session.send("First");
      assert.equal(session.isProcessing, true);

      // Second send should be ignored
      session.send("Second");
      // Still processing from first
      assert.equal(session.isProcessing, true);

      session.close();
    });
  });

  describe("stream handling", () => {
    it("captures session ID from system init", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);

      harness.fakeQuery.emit({
        type: "system",
        subtype: "init",
        session_id: "sess-abc-123",
        model: "claude-sonnet-4-6",
        cwd: "/test",
        tools: ["Read", "Write"],
      });

      await tick();
      assert.equal(session.sessionId, "sess-abc-123");
      session.close();
    });

    it("emits output from assistant text blocks", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);
      const outputs = collectEvents(session, "output");

      harness.fakeQuery.emit({
        type: "assistant",
        session_id: "sess-1",
        message: {
          content: [{ type: "text", text: "Hello! How can I help?" }],
        },
      });

      await tick();
      assert.ok(outputs.length >= 1);
      const textOutputs = outputs.filter(([o]) => o.text && !o.isWaiting);
      assert.ok(textOutputs.length >= 1);
      assert.equal(textOutputs[0][0].text, "Hello! How can I help?");
      session.close();
    });

    it("emits thinking activity from thinking blocks", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);
      const activities = collectEvents(session, "activity");

      harness.fakeQuery.emit({
        type: "assistant",
        session_id: "sess-1",
        message: {
          content: [{ type: "thinking", thinking: "Let me think about this..." }],
        },
      });

      await tick();
      const thinkingActs = activities.filter(([a]) => a.activity === "thinking");
      assert.ok(thinkingActs.length >= 1);
      assert.ok(thinkingActs[0][0].detail.includes("Let me think"));
      session.close();
    });

    it("emits tool_use activity for regular tools", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);
      const activities = collectEvents(session, "activity");

      harness.fakeQuery.emit({
        type: "assistant",
        session_id: "sess-1",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Read",
              id: "tu-1",
              input: { file_path: "/test/file.ts" },
            },
          ],
        },
      });

      await tick();
      const toolActs = activities.filter(([a]) => a.activity === "tool_use");
      assert.ok(toolActs.length >= 1);
      assert.equal(toolActs[0][0].tool, "Read");
      assert.equal(toolActs[0][0].detail, "/test/file.ts");
      session.close();
    });

    it("suppresses assistant text when the same message also contains tool use", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);
      const outputs = collectEvents(session, "output");
      const activities = collectEvents(session, "activity");

      harness.fakeQuery.emit({
        type: "assistant",
        session_id: "sess-1",
        message: {
          content: [
            { type: "text", text: "Let me inspect that for you." },
            {
              type: "tool_use",
              name: "Read",
              id: "tu-1",
              input: { file_path: "/test/file.ts" },
            },
          ],
        },
      });

      await tick();
      const textOutputs = outputs.filter(([o]) => o.text && !o.isWaiting);
      const toolActs = activities.filter(([a]) => a.activity === "tool_use");
      assert.equal(textOutputs.length, 0);
      assert.equal(toolActs.length, 1);
      session.close();
    });

    it("tracks file changes from Edit/Write tools", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);
      const activities = collectEvents(session, "activity");

      harness.fakeQuery.emit({
        type: "assistant",
        session_id: "sess-1",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Edit",
              id: "tu-1",
              input: { file_path: "/test/foo.ts" },
            },
          ],
        },
      });

      await tick();
      const fileActs = activities.filter(([a]) => a.activity === "file_list");
      assert.ok(fileActs.length >= 1);
      assert.equal(fileActs[0][0].files[0].path, "/test/foo.ts");
      assert.equal(fileActs[0][0].files[0].type, "edited");
      session.close();
    });

    it("suppresses task tools from chat and emits task_list", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);
      const activities = collectEvents(session, "activity");

      harness.fakeQuery.emit({
        type: "assistant",
        session_id: "sess-1",
        message: {
          content: [
            {
              type: "tool_use",
              name: "TodoWrite",
              id: "tu-1",
              input: {
                todos: [
                  { content: "Fix bug", status: "pending" },
                  { content: "Write tests", status: "in_progress" },
                ],
              },
            },
          ],
        },
      });

      await tick();
      // Should get a task_list, not a tool_use
      const taskActs = activities.filter(([a]) => a.activity === "task_list");
      const toolActs = activities.filter(
        ([a]) => a.activity === "tool_use" && a.tool === "TodoWrite",
      );
      assert.ok(taskActs.length >= 1);
      assert.equal(toolActs.length, 0);
      assert.equal(taskActs[0][0].tasks.length, 2);
      assert.equal(taskActs[0][0].tasks[0].subject, "Fix bug");
      session.close();
    });

    it("emits isWaiting output and goes idle on result", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);
      const outputs = collectEvents(session, "output");

      session.send("hello");
      assert.equal(session.isProcessing, true);

      harness.fakeQuery.emit({
        type: "result",
        subtype: "success",
        session_id: "sess-1",
        is_error: false,
        result: "Done",
        modelUsage: {
          "claude-sonnet-4-6": {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            costUSD: 0.001,
          },
        },
      });

      await tick();
      const waitingOutputs = outputs.filter(([o]) => o.isWaiting);
      assert.ok(waitingOutputs.length >= 1);
      assert.equal(session.isProcessing, false);
      session.close();
    });

    it("accumulates stats from result modelUsage", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);
      const statsEvents = collectEvents(session, "stats");

      harness.fakeQuery.emit({
        type: "result",
        subtype: "success",
        session_id: "sess-1",
        is_error: false,
        modelUsage: {
          "claude-sonnet-4-6": {
            inputTokens: 100,
            outputTokens: 50,
            cacheReadInputTokens: 10,
            cacheCreationInputTokens: 5,
            costUSD: 0.002,
          },
        },
      });

      await tick();
      assert.ok(statsEvents.length >= 1);
      const lastStats = statsEvents[statsEvents.length - 1][0];
      assert.equal(lastStats.inputTokens, 100);
      assert.equal(lastStats.outputTokens, 50);
      assert.equal(lastStats.model, "claude-sonnet-4-6");
      assert.ok(lastStats.costUSD > 0);
      session.close();
    });

    it("emits exit on error result", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);
      const exits = collectEvents(session, "exit");

      harness.fakeQuery.emit({
        type: "result",
        subtype: "error_during_execution",
        session_id: "sess-1",
        is_error: true,
        errors: ["Something went wrong"],
        modelUsage: {},
      });

      await tick();
      assert.ok(exits.length >= 1);
      assert.equal(exits[0][0].code, 1);
      assert.ok(exits[0][0].stderr.includes("Something went wrong"));
      session.close();
    });
  });

  describe("permissions", () => {
    it("auto-allows pre-approved tools via canUseTool", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness, {
        allowedTools: ["Bash"],
      });

      // Simulate the SDK calling canUseTool for an approved tool
      const capturedOptions = {};
      const fakeQuery = new FakeQuery();
      let canUseToolFn;
      const session2 = await createSdkSession({
        cwd: "/test",
        allowedTools: ["Bash"],
        logger: noopLogger,
        queryFn: ({ prompt, options }) => {
          canUseToolFn = options.canUseTool;
          return fakeQuery;
        },
      });

      const result = await canUseToolFn(
        "Bash",
        { command: "ls" },
        {
          signal: new AbortController().signal,
          toolUseID: "tu-1",
        },
      );
      assert.equal(result.behavior, "allow");
      assert.deepEqual(result.updatedInput, { command: "ls" });
      session.close();
      session2.close();
    });

    it("emits permissionRequest and blocks on unapproved tools", async () => {
      const fakeQuery = new FakeQuery();
      let canUseToolFn;
      const session = await createSdkSession({
        cwd: "/test",
        logger: noopLogger,
        queryFn: ({ prompt, options }) => {
          canUseToolFn = options.canUseTool;
          return fakeQuery;
        },
      });

      const requests = collectEvents(session, "permissionRequest");

      // Call canUseTool for an unapproved tool — should block
      const resultPromise = canUseToolFn(
        "Bash",
        { command: "rm -rf /" },
        {
          signal: new AbortController().signal,
          toolUseID: "tu-1",
        },
      );

      await tick();

      // Should have emitted a permissionRequest event (not an activity)
      assert.ok(requests.length >= 1);
      assert.equal(requests[0][0].tool, "Bash");

      // Approve the permission
      const approved = session.approvePermission("Bash");
      assert.ok(approved);

      const result = await resultPromise;
      assert.equal(result.behavior, "allow");
      assert.deepEqual(result.updatedInput, { command: "rm -rf /" });

      session.close();
    });

    it("denies permission when signal is aborted", async () => {
      const fakeQuery = new FakeQuery();
      let canUseToolFn;
      const session = await createSdkSession({
        cwd: "/test",
        logger: noopLogger,
        queryFn: ({ prompt, options }) => {
          canUseToolFn = options.canUseTool;
          return fakeQuery;
        },
      });

      const abortController = new AbortController();
      const resultPromise = canUseToolFn(
        "Bash",
        { command: "ls" },
        {
          signal: abortController.signal,
          toolUseID: "tu-1",
        },
      );

      await tick();
      abortController.abort();

      const result = await resultPromise;
      assert.equal(result.behavior, "deny");

      session.close();
    });

    it("groups file-write tool approvals", async () => {
      const fakeQuery = new FakeQuery();
      let canUseToolFn;
      const session = await createSdkSession({
        cwd: "/test",
        allowedTools: ["Edit"],
        logger: noopLogger,
        queryFn: ({ prompt, options }) => {
          canUseToolFn = options.canUseTool;
          return fakeQuery;
        },
      });

      // Write should be auto-approved since Edit is in the allowed set
      const result = await canUseToolFn(
        "Write",
        { file_path: "/test/f.ts" },
        {
          signal: new AbortController().signal,
          toolUseID: "tu-1",
        },
      );
      assert.equal(result.behavior, "allow");
      assert.deepEqual(result.updatedInput, { file_path: "/test/f.ts" });

      session.close();
    });
  });

  describe("control methods", () => {
    it("interrupt() calls query.interrupt()", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);

      session.interrupt();
      await tick();
      assert.equal(harness.fakeQuery.interruptCalls, 1);
      session.close();
    });

    it("setModel() calls query.setModel()", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);

      session.setModel("claude-opus-4-6");
      await tick();
      assert.deepEqual(harness.fakeQuery.setModelCalls, ["claude-opus-4-6"]);

      session.setModel(null);
      await tick();
      assert.deepEqual(harness.fakeQuery.setModelCalls, ["claude-opus-4-6", undefined]);
      session.close();
    });

    it("setReasoningBudget() calls query.setMaxThinkingTokens()", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);

      session.setReasoningBudget(30000);
      await tick();
      session.setReasoningBudget(null);
      await tick();

      assert.deepEqual(harness.fakeQuery.setMaxThinkingTokensCalls, [30000, null]);
      session.close();
    });

    it("close() terminates the session", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);

      session.close();
      await tick();
      assert.equal(harness.fakeQuery.closeCalls, 1);
    });
  });

  describe("plan mode", () => {
    it("setPlanMode() calls query.setPermissionMode()", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);

      session.setPlanMode(true);
      session.setPlanMode(false);

      await tick();

      assert.deepEqual(harness.fakeQuery.setPermissionModeCalls, ["plan", "default"]);
      session.close();
    });
  });

  describe("stream_event (partial messages)", () => {
    it("buffers text deltas and emits them on message_stop for text-only messages", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);
      const outputs = collectEvents(session, "output");

      harness.fakeQuery.emit({
        type: "stream_event",
        session_id: "sess-1",
        event: {
          type: "message_start",
        },
      });

      harness.fakeQuery.emit({
        type: "stream_event",
        session_id: "sess-1",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
      });

      harness.fakeQuery.emit({
        type: "stream_event",
        session_id: "sess-1",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello " },
        },
      });

      harness.fakeQuery.emit({
        type: "stream_event",
        session_id: "sess-1",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "world!" },
        },
      });

      harness.fakeQuery.emit({
        type: "stream_event",
        session_id: "sess-1",
        event: {
          type: "message_stop",
        },
      });

      await tick();
      const textOutputs = outputs.filter(([o]) => o.text && !o.isWaiting);
      assert.equal(textOutputs.length, 1);
      assert.equal(textOutputs[0][0].text, "Hello world!");
      session.close();
    });

    it("drops buffered text deltas when the assistant message becomes tool use", async () => {
      const harness = makeHarness();
      const session = await createTestSession(harness);
      const outputs = collectEvents(session, "output");

      harness.fakeQuery.emit({
        type: "stream_event",
        session_id: "sess-1",
        event: {
          type: "message_start",
        },
      });

      harness.fakeQuery.emit({
        type: "stream_event",
        session_id: "sess-1",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
      });

      harness.fakeQuery.emit({
        type: "stream_event",
        session_id: "sess-1",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Let me check that." },
        },
      });

      harness.fakeQuery.emit({
        type: "stream_event",
        session_id: "sess-1",
        event: {
          type: "content_block_start",
          index: 1,
          content_block: { type: "tool_use", id: "tu-1", name: "Read", input: {} },
        },
      });

      harness.fakeQuery.emit({
        type: "stream_event",
        session_id: "sess-1",
        event: {
          type: "message_stop",
        },
      });

      await tick();
      const textOutputs = outputs.filter(([o]) => o.text && !o.isWaiting);
      assert.equal(textOutputs.length, 0);
      session.close();
    });
  });

  describe("createSdkSessionSync", () => {
    it("creates a session synchronously with a pre-resolved queryFn", () => {
      const harness = makeHarness();
      const session = createSdkSessionSync(
        {
          cwd: "/test/project",
          logger: noopLogger,
          queryFn: harness.queryFn,
        },
        harness.queryFn,
      );

      assert.ok(session);
      assert.equal(session.isProcessing, false);
      assert.equal(typeof session.send, "function");
      assert.equal(typeof session.interrupt, "function");
      assert.equal(typeof session.close, "function");
      assert.equal(typeof session.approvePermission, "function");
      session.close();
    });

    it("works identically to the async createSdkSession", async () => {
      const harness = makeHarness();
      const session = createSdkSessionSync(
        { cwd: "/test/project", logger: noopLogger },
        harness.queryFn,
      );
      const outputs = collectEvents(session, "output");

      harness.fakeQuery.emit({
        type: "assistant",
        session_id: "sess-sync",
        message: { content: [{ type: "text", text: "sync works" }] },
      });
      await tick();

      assert.equal(session.sessionId, "sess-sync");
      const textOutputs = outputs.filter(([o]) => !o.isWaiting);
      assert.equal(textOutputs[0][0].text, "sync works");
      session.close();
    });
  });
});
