import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { CodexAppServerSession } from "../dist/core/providers/codex-app-server.js";

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

class FakeChildProcess extends EventEmitter {
  constructor() {
    super();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new PassThrough();
    this.pid = 5050;
    this.exitCode = null;
    this.killed = false;
    this.killedSignals = [];

    // Capture what's written to stdin
    this._stdinWrites = [];
    const origWrite = this.stdin.write.bind(this.stdin);
    this.stdin.write = (data) => {
      this._stdinWrites.push(data.toString());
      return origWrite(data);
    };
  }

  kill(signal = "SIGTERM") {
    this.killedSignals.push(signal);
    this.killed = true;
    return true;
  }

  getStdinMessages() {
    return this._stdinWrites.map((line) => {
      try {
        return JSON.parse(line.trim());
      } catch {
        return line;
      }
    });
  }
}

function createHarness() {
  const spawns = [];
  const children = [];

  return {
    spawns,
    children,
    spawnProcess(command, args, options) {
      const child = new FakeChildProcess();
      spawns.push({ command, args, options });
      children.push(child);
      return child;
    },
  };
}

function collectEvents(session, eventName) {
  const events = [];
  session.on(eventName, (...args) => events.push(args));
  return events;
}

function tick(ms = 25) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Simulate the app-server responding to JSON-RPC requests on stdin by writing to stdout */
function autoRespond(child) {
  child.stdin.on("data", (chunk) => {
    const lines = chunk.toString().trim().split("\n");
    for (const line of lines) {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }

      // Only respond to requests (have id and method)
      if (msg.id === undefined || !msg.method) continue;

      if (msg.method === "initialize") {
        child.stdout.write(
          JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { userAgent: "codex-test/1.0" } }) +
            "\n",
        );
      } else if (msg.method === "thread/start") {
        child.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              thread: {
                id: "thread-001",
                cwd: msg.params?.cwd ?? "/tmp",
                status: { type: "idle" },
                preview: "",
                ephemeral: false,
                modelProvider: "openai",
                createdAt: Date.now() / 1000,
                updatedAt: Date.now() / 1000,
                path: null,
                cliVersion: "1.0",
                source: "app-server",
                agentNickname: null,
                agentRole: null,
                gitInfo: null,
                name: null,
                turns: [],
              },
            },
          }) + "\n",
        );
      } else if (msg.method === "thread/resume") {
        child.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              thread: {
                id: msg.params?.threadId ?? "thread-resumed",
                cwd: msg.params?.cwd ?? "/tmp",
                status: { type: "idle" },
                preview: "",
                ephemeral: false,
                modelProvider: "openai",
                createdAt: Date.now() / 1000,
                updatedAt: Date.now() / 1000,
                path: null,
                cliVersion: "1.0",
                source: "app-server",
                agentNickname: null,
                agentRole: null,
                gitInfo: null,
                name: null,
                turns: [],
              },
            },
          }) + "\n",
        );
      } else if (msg.method === "turn/start") {
        child.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {},
          }) + "\n",
        );
      } else if (msg.method === "turn/interrupt") {
        child.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\n");
      } else {
        child.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\n");
      }
    }
  });
}

describe("CodexAppServerSession", () => {
  it("spawns codex app-server with stdio transport", async () => {
    const harness = createHarness();
    const session = new CodexAppServerSession({
      cwd: "/tmp/project",
      model: "o3",
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "/tmp/fake-codex",
    });

    session.send("hello");
    // spawnProcess was called by send()
    const child = harness.children[0];
    autoRespond(child);

    await tick(50);

    assert.equal(harness.spawns.length, 1);
    assert.equal(harness.spawns[0].command, "/tmp/fake-codex");
    assert.deepEqual(harness.spawns[0].args, ["app-server", "--listen", "stdio://"]);
    assert.equal(harness.spawns[0].options.cwd, "/tmp/project");

    session.close();
  });

  it("initializes, starts thread, and starts turn via JSON-RPC", async () => {
    const harness = createHarness();
    const session = new CodexAppServerSession({
      cwd: "/tmp/project",
      model: "gpt-5.4",
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "codex",
    });

    session.send("hello");
    const child = harness.children[0];
    autoRespond(child);

    await tick(50);

    const msgs = child.getStdinMessages();
    const methods = msgs.filter((m) => m.method).map((m) => m.method);

    assert.ok(methods.includes("initialize"), "Should send initialize");
    assert.ok(methods.includes("thread/start"), "Should send thread/start");
    assert.ok(methods.includes("turn/start"), "Should send turn/start");

    // Check thread/start params
    const threadStart = msgs.find((m) => m.method === "thread/start");
    assert.equal(threadStart.params.model, "gpt-5.4");
    assert.equal(threadStart.params.cwd, "/tmp/project");

    // Check turn/start has the message
    const turnStart = msgs.find((m) => m.method === "turn/start");
    assert.equal(turnStart.params.input[0].text, "hello");
    assert.equal(turnStart.params.collaborationMode.mode, "default");
    assert.equal(turnStart.params.collaborationMode.settings.model, "gpt-5.4");

    session.close();
  });

  it("passes collaborationMode=plan when plan mode is enabled", async () => {
    const harness = createHarness();
    const session = new CodexAppServerSession({
      cwd: "/tmp/project",
      model: "gpt-5.4",
      planMode: true,
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "codex",
    });

    session.send("plan this change");
    const child = harness.children[0];
    autoRespond(child);

    await tick(50);

    const msgs = child.getStdinMessages();
    const turnStart = msgs.find((m) => m.method === "turn/start");
    assert.equal(turnStart.params.collaborationMode.mode, "plan");
    assert.equal(turnStart.params.collaborationMode.settings.model, "gpt-5.4");

    session.close();
  });

  it("resumes an existing thread when resumeSessionId is provided", async () => {
    const harness = createHarness();
    const session = new CodexAppServerSession({
      cwd: "/tmp/project",
      resumeSessionId: "thread-existing",
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "codex",
    });

    session.send("continue");
    const child = harness.children[0];
    autoRespond(child);

    await tick(50);

    const msgs = child.getStdinMessages();
    const methods = msgs.filter((m) => m.method).map((m) => m.method);

    assert.ok(
      methods.includes("thread/resume"),
      "Should send thread/resume instead of thread/start",
    );
    assert.ok(!methods.includes("thread/start"), "Should NOT send thread/start");

    const threadResume = msgs.find((m) => m.method === "thread/resume");
    assert.equal(threadResume.params.threadId, "thread-existing");

    session.close();
  });

  it("streams text via agentMessage/delta notifications", async () => {
    const harness = createHarness();
    const session = new CodexAppServerSession({
      cwd: "/tmp/project",
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "codex",
    });
    const outputs = collectEvents(session, "output");

    session.send("say hello");
    const child = harness.children[0];
    autoRespond(child);

    await tick(50);

    // Simulate streaming text
    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "turn/started",
        params: {
          threadId: "thread-001",
          turn: { id: "turn-1", items: [], status: "inProgress", error: null },
        },
      }) + "\n",
    );
    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "item/agentMessage/delta",
        params: { threadId: "thread-001", turnId: "turn-1", itemId: "msg-1", delta: "Hello" },
      }) + "\n",
    );
    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "item/agentMessage/delta",
        params: { threadId: "thread-001", turnId: "turn-1", itemId: "msg-1", delta: " world!" },
      }) + "\n",
    );
    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: {
          threadId: "thread-001",
          turn: { id: "turn-1", items: [], status: "completed", error: null },
        },
      }) + "\n",
    );

    await tick();

    // Find the streaming deltas (skip any from auto-respond)
    const textOutputs = outputs.filter(([o]) => o.text !== "");
    assert.ok(
      textOutputs.length >= 2,
      `Expected at least 2 text outputs, got ${textOutputs.length}`,
    );
    assert.equal(textOutputs[0][0].text, "Hello");
    assert.equal(textOutputs[1][0].text, " world!");

    // Should have a final isWaiting=true output
    const waitingOutputs = outputs.filter(([o]) => o.isWaiting === true);
    assert.ok(waitingOutputs.length >= 1, "Expected at least one isWaiting output");

    assert.equal(session.isProcessing, false);
    session.close();
  });

  it("maps command execution items to tool activities", async () => {
    const harness = createHarness();
    const session = new CodexAppServerSession({
      cwd: "/tmp/project",
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "codex",
    });
    const activities = collectEvents(session, "activity");

    session.send("run ls");
    const child = harness.children[0];
    autoRespond(child);

    await tick(50);

    // Simulate command execution
    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "item/started",
        params: {
          threadId: "thread-001",
          turnId: "turn-1",
          item: {
            type: "commandExecution",
            id: "cmd-1",
            command: "ls -la",
            cwd: "/tmp/project",
            status: "inProgress",
            commandActions: [],
            aggregatedOutput: null,
            exitCode: null,
            durationMs: null,
          },
        },
      }) + "\n",
    );
    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "item/completed",
        params: {
          threadId: "thread-001",
          turnId: "turn-1",
          item: {
            type: "commandExecution",
            id: "cmd-1",
            command: "ls -la",
            cwd: "/tmp/project",
            status: "completed",
            commandActions: [],
            aggregatedOutput: "file1.ts\nfile2.ts\n",
            exitCode: 0,
            durationMs: 50,
          },
        },
      }) + "\n",
    );

    await tick();

    const toolUse = activities.find(([a]) => a.activity === "tool_use" && a.tool === "Bash");
    assert.ok(toolUse, "Expected a tool_use activity for Bash");
    assert.match(toolUse[0].description, /Running command/);

    const toolResult = activities.find(([a]) => a.activity === "tool_result" && a.tool === "Bash");
    assert.ok(toolResult, "Expected a tool_result activity for Bash");
    assert.equal(toolResult[0].description, "Command completed");
  });

  it("tracks file changes from fileChange items", async () => {
    const harness = createHarness();
    const session = new CodexAppServerSession({
      cwd: "/tmp/project",
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "codex",
    });
    const activities = collectEvents(session, "activity");

    session.send("edit files");
    const child = harness.children[0];
    autoRespond(child);

    await tick(50);

    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "item/completed",
        params: {
          threadId: "thread-001",
          turnId: "turn-1",
          item: {
            type: "fileChange",
            id: "fc-1",
            changes: [
              { path: "src/app.ts", kind: { type: "update", move_path: null }, diff: "+foo\n-bar" },
              { path: "src/new.ts", kind: { type: "add" }, diff: "+new file" },
            ],
            status: "completed",
          },
        },
      }) + "\n",
    );

    await tick();

    const fileList = activities.find(([a]) => a.activity === "file_list");
    assert.ok(fileList, "Expected a file_list activity");
    assert.equal(fileList[0].files.length, 2);

    const appTs = fileList[0].files.find((f) => f.path === "src/app.ts");
    assert.ok(appTs);
    assert.equal(appTs.type, "edited");

    const newTs = fileList[0].files.find((f) => f.path === "src/new.ts");
    assert.ok(newTs);
    assert.equal(newTs.type, "added");
  });

  it("filters file changes outside the current workspace", async () => {
    const harness = createHarness();
    const session = new CodexAppServerSession({
      cwd: "/tmp/project",
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "codex",
    });
    const activities = collectEvents(session, "activity");

    session.send("edit files");
    const child = harness.children[0];
    autoRespond(child);

    await tick(50);

    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "item/completed",
        params: {
          threadId: "thread-001",
          turnId: "turn-1",
          item: {
            type: "fileChange",
            id: "fc-1",
            changes: [
              { path: "src/app.ts", kind: { type: "update", move_path: null }, diff: "+foo\n-bar" },
              {
                path: "/Users/test/.claude/plans/session-plan.md",
                kind: { type: "update", move_path: null },
                diff: "+plan\n-old",
              },
            ],
            status: "completed",
          },
        },
      }) + "\n",
    );

    await tick();

    const fileList = activities.find(([a]) => a.activity === "file_list");
    assert.ok(fileList, "Expected a file_list activity");
    assert.equal(fileList[0].files.length, 1);
    assert.equal(fileList[0].files[0].path, "src/app.ts");
  });

  it("handles token usage notifications", async () => {
    const harness = createHarness();
    const session = new CodexAppServerSession({
      cwd: "/tmp/project",
      model: "gpt-5.4",
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "codex",
    });
    const statsEvents = collectEvents(session, "stats");

    session.send("hello");
    const child = harness.children[0];
    autoRespond(child);

    await tick(50);

    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "thread/tokenUsage/updated",
        params: {
          threadId: "thread-001",
          turnId: "turn-1",
          tokenUsage: {
            total: {
              totalTokens: 100,
              inputTokens: 60,
              cachedInputTokens: 10,
              outputTokens: 30,
              reasoningOutputTokens: 0,
            },
            last: {
              totalTokens: 100,
              inputTokens: 60,
              cachedInputTokens: 10,
              outputTokens: 30,
              reasoningOutputTokens: 0,
            },
            modelContextWindow: 200000,
          },
        },
      }) + "\n",
    );

    await tick();

    assert.ok(statsEvents.length >= 1, "Expected at least one stats event");
    const lastStats = statsEvents[statsEvents.length - 1][0];
    assert.equal(lastStats.model, "gpt-5.4");
    assert.equal(lastStats.inputTokens, 60);
    assert.equal(lastStats.cacheReadTokens, 10);
    assert.equal(lastStats.outputTokens, 30);
    assert.equal(lastStats.contextWindow, 200000);
  });

  it("emits task_list activity for turn/plan/updated notifications", async () => {
    const harness = createHarness();
    const session = new CodexAppServerSession({
      cwd: "/tmp/project",
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "codex",
    });
    const activities = collectEvents(session, "activity");

    session.send("make a plan");
    const child = harness.children[0];
    autoRespond(child);

    await tick(50);

    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "turn/plan/updated",
        params: {
          threadId: "thread-001",
          turnId: "turn-1",
          explanation: "Working plan",
          plan: [
            { step: "Inspect the code", status: "completed" },
            { step: "Apply the fix", status: "inProgress" },
            { step: "Run checks", status: "pending" },
          ],
        },
      }) + "\n",
    );

    await tick();

    const taskList = activities.find(([a]) => a.activity === "task_list");
    assert.ok(taskList, "Expected a task_list activity");
    assert.equal(taskList[0].description, "Working plan");
    assert.deepEqual(taskList[0].tasks, [
      { id: "plan-0", subject: "Inspect the code", status: "completed" },
      { id: "plan-1", subject: "Apply the fix", status: "in_progress" },
      { id: "plan-2", subject: "Run checks", status: "pending" },
    ]);
  });

  it("emits permissionRequest for command approval and routes response", async () => {
    const harness = createHarness();
    const session = new CodexAppServerSession({
      cwd: "/tmp/project",
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "codex",
    });
    const permRequests = collectEvents(session, "permissionRequest");

    session.send("run something dangerous");
    const child = harness.children[0];
    autoRespond(child);

    await tick(50);

    // Server sends a requestApproval
    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 42,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thread-001",
          turnId: "turn-1",
          itemId: "cmd-1",
          command: "rm -rf /",
          cwd: "/tmp",
        },
      }) + "\n",
    );

    await tick();

    assert.equal(permRequests.length, 1);
    assert.equal(permRequests[0][0].requestId, "codex-approval-42");
    assert.equal(permRequests[0][0].tool, "Bash");
    assert.equal(permRequests[0][0].description, "rm -rf /");

    // Respond to the request
    const responded = session.respondToRequest("codex-approval-42", "accept");
    assert.equal(responded, true);

    await tick();

    // Check that the response was sent to stdin
    const msgs = child.getStdinMessages();
    const rpcResponse = msgs.find((m) => m.id === 42 && m.result !== undefined && !m.method);
    assert.ok(rpcResponse, "Expected an RPC response for the approval");
    assert.equal(rpcResponse.result.decision, "accept");
  });

  it("emits request_user_input prompts and routes structured answers", async () => {
    const harness = createHarness();
    const session = new CodexAppServerSession({
      cwd: "/tmp/project",
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "codex",
    });
    const requests = collectEvents(session, "permissionRequest");
    const activities = collectEvents(session, "activity");

    session.send("ask me a question");
    const child = harness.children[0];
    autoRespond(child);

    await tick(50);

    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "item/tool/requestUserInput",
        params: {
          threadId: "thread-001",
          turnId: "turn-1",
          itemId: "call-1",
          questions: [
            {
              id: "color",
              header: "Palette",
              question: "Pick a color",
              isOther: true,
              options: [
                { label: "Blue", description: "Recommended" },
                { label: "Green", description: "Alternative" },
              ],
            },
          ],
        },
      }) + "\n",
    );

    await tick();

    assert.equal(requests.length, 1);
    assert.equal(requests[0][0].kind, "user_input");
    assert.equal(requests[0][0].requestId, "codex-input-call-1");
    assert.equal(requests[0][0].questions[0].question, "Pick a color");

    const promptActivity = activities.find(([a]) => a.activity === "tool_use");
    assert.ok(promptActivity, "Expected a tool_use activity for request_user_input");
    assert.equal(promptActivity[0].tool, "AskUserQuestion");
    assert.equal(promptActivity[0].input.requestId, "codex-input-call-1");

    const responded = session.respondToRequest("codex-input-call-1", "accept", {
      answers: {
        color: {
          answers: ["Blue"],
        },
      },
    });
    assert.equal(responded, true);

    await tick();

    const msgs = child.getStdinMessages();
    const rpcResponse = msgs.find((m) => m.id === 7 && m.result !== undefined && !m.method);
    assert.ok(rpcResponse, "Expected an RPC response for request_user_input");
    assert.deepEqual(rpcResponse.result, {
      answers: {
        color: {
          answers: ["Blue"],
        },
      },
    });

    const resolution = activities.find(
      ([a]) => a.activity === "tool_result" && a.tool === "AskUserQuestion",
    );
    assert.ok(resolution, "Expected a tool_result activity for request_user_input");
    assert.equal(resolution[0].resolution, "approved");
  });

  it("auto-approves when bypass permissions is enabled", async () => {
    const harness = createHarness();
    const session = new CodexAppServerSession({
      cwd: "/tmp/project",
      dangerouslySkipPermissions: true,
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "codex",
    });
    const permRequests = collectEvents(session, "permissionRequest");

    session.send("run something");
    const child = harness.children[0];
    autoRespond(child);

    await tick(50);

    // Server sends a requestApproval
    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: "thread-001",
          turnId: "turn-1",
          itemId: "cmd-1",
          command: "dangerous-cmd",
        },
      }) + "\n",
    );

    await tick();

    // Should NOT emit permissionRequest (auto-approved)
    assert.equal(
      permRequests.length,
      0,
      "Should not emit permissionRequest when bypass is enabled",
    );

    // Check that the approval was sent automatically
    const msgs = child.getStdinMessages();
    const rpcResponse = msgs.find((m) => m.id === 99 && m.result !== undefined && !m.method);
    assert.ok(rpcResponse, "Expected an auto-approval RPC response");
    assert.equal(rpcResponse.result.decision, "accept");
  });

  it("reuses persistent connection for multiple turns", async () => {
    const harness = createHarness();
    const session = new CodexAppServerSession({
      cwd: "/tmp/project",
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "codex",
    });

    session.send("first message");
    const child = harness.children[0];
    autoRespond(child);

    await tick(50);

    // Complete the first turn
    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: {
          threadId: "thread-001",
          turn: { id: "turn-1", items: [], status: "completed", error: null },
        },
      }) + "\n",
    );

    await tick();

    assert.equal(session.isProcessing, false);

    // Send second message — should NOT spawn a new process
    session.send("second message");

    await tick(50);

    assert.equal(harness.spawns.length, 1, "Should reuse same process, not spawn another");

    // Check that a second turn/start was sent
    const msgs = child.getStdinMessages();
    const turnStarts = msgs.filter((m) => m.method === "turn/start");
    assert.equal(turnStarts.length, 2, "Expected two turn/start messages");
    assert.equal(turnStarts[1].params.input[0].text, "second message");

    session.close();
  });
});
