import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InstanceManager } from "../dist/core/instance-manager.js";
import { resolveConfig } from "../dist/server/config.js";

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

/**
 * Create a minimal JSONL file with an init entry.
 */
function writeMinimalJsonl(path, cwd) {
  const sessionId = path.split("/").pop().replace(".jsonl", "");
  const initEntry = {
    type: "init",
    cwd,
    sessionId,
    timestamp: new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(initEntry) + "\n");
}

function makeConfig(overrides = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), "relay-dedup-test-"));
  return {
    config: resolveConfig({
      password: "test",
      logger: noopLogger,
      maxProcesses: 10,
      dbPath: join(tempDir, "sessions.db"),
      claudeDir: join(tempDir, ".claude"),
      codexDir: join(tempDir, ".codex"),
      ...overrides,
    }),
    tempDir,
  };
}

/**
 * Inject a managed instance WITHOUT jsonlPath (simulating the state before
 * captureSessionId has fired — the race window where duplicates occur).
 */
function injectManagedInstance(manager, instanceId, workingDirectory) {
  const instances = manager["instances"];
  const info = {
    id: instanceId,
    name: "New Session",
    workingDirectory,
    status: "processing",
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    // No "external" flag — this is managed
  };
  const instance = {
    info,
    process: null,
    providerBinding: { provider: "claude" },
    history: [],
    // jsonlPath deliberately NOT set — simulates pre-captureSessionId state
  };
  instances.set(instanceId, instance);
  return instance;
}

describe("Discovery deduplication — managed instance JSONL reservation", () => {
  let manager;
  let tempDir;
  let claudeDir;
  let fakeCwd;
  let projectDir;

  beforeEach(() => {
    const setup = makeConfig();
    manager = new InstanceManager(setup.config);
    tempDir = setup.tempDir;
    claudeDir = join(tempDir, ".claude");

    // Set up a fake working directory and its corresponding .claude/projects/ dir
    fakeCwd = join(tempDir, "projects", "my-repo");
    mkdirSync(fakeCwd, { recursive: true });
    const encoded = fakeCwd.replace(/\//g, "-");
    projectDir = join(claudeDir, "projects", encoded);
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    manager.stopAll();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not create duplicate external when managed instance has no jsonlPath yet", async () => {
    // 1. Create an older JSONL (the "external" terminal session's file)
    const externalJsonl = join(projectDir, "aaaa-external-session.jsonl");
    writeMinimalJsonl(externalJsonl, fakeCwd);
    const past = new Date(Date.now() - 60_000);
    utimesSync(externalJsonl, past, past);

    // 2. Create a newer JSONL (the managed instance's file, just created by claude -p)
    const managedJsonl = join(projectDir, "zzzz-managed-session.jsonl");
    writeMinimalJsonl(managedJsonl, fakeCwd);
    // Leave mtime as now — it's the most recently modified

    // 3. Inject a managed instance WITHOUT jsonlPath (pre-captureSessionId)
    injectManagedInstance(manager, "managed-1", fakeCwd);

    // 4. Override findRunningClaudeCwdsAsync to simulate one external `claude` process in fakeCwd
    //    (the managed process's PID would already be excluded, so only the external remains)
    manager["findRunningClaudeCwdsAsync"] = () => {
      return Promise.resolve(new Map([[fakeCwd, { count: 1, pids: [99999] }]]));
    };

    // 5. Run discovery
    await manager["discoverExisting"]();

    // 6. Verify: should have the managed instance + one external (the older JSONL),
    //    NOT a duplicate for the managed instance's JSONL
    const allInstances = manager.listInstances();
    const managedInstances = allInstances.filter((i) => !i.external);
    const externalInstances = allInstances.filter((i) => i.external);

    assert.equal(managedInstances.length, 1, "Should have exactly 1 managed instance");
    // The external process (count=1) should pick up the older JSONL, NOT the managed one.
    // With the fix, the managed instance's newest JSONL is reserved in knownJsonls,
    // so findRecentJsonls(count=1) returns the newest JSONL which is already reserved,
    // and discovery skips it.
    assert.equal(
      externalInstances.length,
      0,
      "Should have 0 external instances (the 1 JSONL found was reserved for the managed instance)",
    );
  });

  it("does not interfere when managed instance already has jsonlPath", async () => {
    // 1. Create a JSONL for the managed instance
    const managedJsonl = join(projectDir, "bbbb-managed.jsonl");
    writeMinimalJsonl(managedJsonl, fakeCwd);
    const past = new Date(Date.now() - 30_000);
    utimesSync(managedJsonl, past, past);

    // 2. Create a newer JSONL for the external session
    const externalJsonl = join(projectDir, "cccc-external.jsonl");
    writeMinimalJsonl(externalJsonl, fakeCwd);

    // 3. Inject a managed instance WITH jsonlPath already set (captureSessionId completed)
    const instances = manager["instances"];
    instances.set("managed-1", {
      info: {
        id: "managed-1",
        name: "Managed Session",
        workingDirectory: fakeCwd,
        status: "idle",
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      },
      process: null,
      providerBinding: { provider: "claude" },
      history: [],
      jsonlPath: managedJsonl, // Already captured
    });

    // 4. Override findRunningClaudeCwdsAsync — 1 external process
    manager["findRunningClaudeCwdsAsync"] = () => {
      return Promise.resolve(new Map([[fakeCwd, { count: 1, pids: [99999] }]]));
    };

    // 5. Run discovery
    await manager["discoverExisting"]();

    // 6. The external JSONL should be discovered normally
    const allInstances = manager.listInstances();
    const externalInstances = allInstances.filter((i) => i.external);
    assert.equal(externalInstances.length, 1, "Should discover the external session");
    assert.ok(
      externalInstances[0].sessionId.includes("cccc-external"),
      "External should be the newer JSONL",
    );
  });

  it("reserves one JSONL per managed instance when multiple are pending", async () => {
    // Create 3 JSONL files
    const jsonl1 = join(projectDir, "aaa-oldest.jsonl");
    writeMinimalJsonl(jsonl1, fakeCwd);
    utimesSync(jsonl1, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));

    const jsonl2 = join(projectDir, "bbb-middle.jsonl");
    writeMinimalJsonl(jsonl2, fakeCwd);
    utimesSync(jsonl2, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));

    const jsonl3 = join(projectDir, "ccc-newest.jsonl");
    writeMinimalJsonl(jsonl3, fakeCwd);
    // newest mtime (now)

    // Inject 2 managed instances without jsonlPath
    injectManagedInstance(manager, "managed-1", fakeCwd);
    injectManagedInstance(manager, "managed-2", fakeCwd);

    // 1 external process found
    manager["findRunningClaudeCwdsAsync"] = () => {
      return Promise.resolve(new Map([[fakeCwd, { count: 1, pids: [99999] }]]));
    };

    await manager["discoverExisting"]();

    const allInstances = manager.listInstances();
    const externalInstances = allInstances.filter((i) => i.external);

    // 2 managed instances reserve the 2 newest JSONLs, discovery finds 1 JSONL (count=1)
    // which is the newest — already reserved. No external created.
    assert.equal(externalInstances.length, 0, "No external duplicates should be created");
  });
});
