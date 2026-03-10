import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { CodexCliSession } from "../dist/core/providers/codex-cli.js";

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
    this.pid = 4242;
    this.killedSignals = [];
  }

  kill(signal = "SIGTERM") {
    this.killedSignals.push(signal);
    this.emit("close", signal === "SIGKILL" ? 137 : 0, signal);
    return true;
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

describe("CodexCliSession", () => {
  it("spawns codex exec with provider-specific flags", () => {
    const harness = createHarness();
    const session = new CodexCliSession({
      cwd: "/tmp/project",
      model: "o3",
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "/tmp/fake-codex",
    });

    session.send("hello");

    assert.equal(harness.spawns.length, 1);
    assert.equal(harness.spawns[0].command, "/tmp/fake-codex");
    assert.deepEqual(harness.spawns[0].args, [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-m",
      "o3",
      "-a",
      "never",
      "-s",
      "workspace-write",
      "hello",
    ]);
    assert.equal(harness.spawns[0].options.cwd, "/tmp/project");
  });

  it("uses exec resume when a session id is present", () => {
    const harness = createHarness();
    const session = new CodexCliSession({
      cwd: "/tmp/project",
      resumeSessionId: "thread-123",
      dangerouslySkipPermissions: true,
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "codex",
    });

    session.send("continue");

    assert.deepEqual(harness.spawns[0].args, [
      "exec",
      "resume",
      "thread-123",
      "--json",
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "continue",
    ]);
  });

  it("maps thread, output, stats, and waiting events", async () => {
    const harness = createHarness();
    const session = new CodexCliSession({
      cwd: "/tmp/project",
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "codex",
    });
    const outputs = collectEvents(session, "output");
    const stats = collectEvents(session, "stats");

    session.send("say ok");
    const child = harness.children[0];
    child.stdout.write('{"type":"thread.started","thread_id":"thread-abc"}\n');
    child.stdout.write('{"type":"turn.started"}\n');
    child.stdout.write(
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"OK"}}\n',
    );
    child.stdout.write(
      '{"type":"turn.completed","usage":{"input_tokens":12,"cached_input_tokens":3,"output_tokens":4}}\n',
    );
    child.emit("close", 0, null);

    await tick();

    assert.equal(session.getRuntimeBinding().providerSessionId, "thread-abc");
    assert.equal(outputs.length, 2);
    assert.deepEqual(outputs[0][0], { type: "output", text: "OK", isWaiting: false });
    assert.deepEqual(outputs[1][0], { type: "output", text: "", isWaiting: true });
    assert.equal(stats.length, 1);
    assert.equal(stats[0][0].inputTokens, 12);
    assert.equal(stats[0][0].cacheReadTokens, 3);
    assert.equal(stats[0][0].outputTokens, 4);
    assert.equal(session.isProcessing, false);
  });

  it("maps command execution into tool activities", async () => {
    const harness = createHarness();
    const session = new CodexCliSession({
      cwd: "/tmp/project",
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "codex",
    });
    const activities = collectEvents(session, "activity");

    session.send("run pwd");
    const child = harness.children[0];
    child.stdout.write(
      '{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc pwd","aggregated_output":"","exit_code":null,"status":"in_progress"}}\n',
    );
    child.stdout.write(
      '{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc pwd","aggregated_output":"/tmp/project\\n","exit_code":0,"status":"completed"}}\n',
    );
    child.stdout.write('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n');
    child.emit("close", 0, null);

    await tick();

    assert.equal(activities.length, 2);
    assert.equal(activities[0][0].activity, "tool_use");
    assert.equal(activities[0][0].tool, "Bash");
    assert.match(activities[0][0].description, /Running command:/);
    assert.equal(activities[1][0].activity, "tool_result");
    assert.equal(activities[1][0].description, "Command completed");
    assert.equal(activities[1][0].detail, "/tmp/project");
  });

  it("emits file_list activity for apply_patch tool calls", async () => {
    const harness = createHarness();
    const session = new CodexCliSession({
      cwd: "/tmp/project",
      logger: noopLogger,
      spawnProcess: harness.spawnProcess,
      codexPath: "codex",
    });
    const activities = collectEvents(session, "activity");

    session.send("patch it");
    const child = harness.children[0];
    child.stdout.write(
      '{"type":"item.started","item":{"id":"patch_0","type":"custom_tool_call","name":"apply_patch","input":"*** Begin Patch\\n*** Update File: src/app.ts\\n@@\\n*** End Patch\\n","status":"in_progress"}}\n',
    );
    child.stdout.write(
      '{"type":"item.completed","item":{"id":"patch_0","type":"custom_tool_call_output","output":"Success. Updated the following files:\\nM src/app.ts\\n","status":"completed"}}\n',
    );
    child.stdout.write('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n');
    child.emit("close", 0, null);

    await tick();

    const fileList = activities.find(([activity]) => activity.activity === "file_list");
    assert.ok(fileList, "Expected a file_list activity");
    assert.deepEqual(fileList[0].files, [{ path: "src/app.ts", editCount: 1, type: "edited" }]);
  });
});
