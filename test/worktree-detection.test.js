/**
 * Tests for worktree detection and recovery:
 * - git.ts: isRelayWorktreePath(), resolveWorktreeOrigin()
 * - instance-manager.ts: getGitInfo() worktree detection
 * - instance-manager.ts: addExternalInstance() / scanAllSessions() worktree path recovery
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir, homedir } from "node:os";
import { execSync } from "node:child_process";
import {
  isRelayWorktreePath,
  resolveWorktreeOrigin,
  createWorktree,
  removeWorktree,
} from "../dist/core/git.js";
import { InstanceManager } from "../dist/core/instance-manager.js";
import { resolveConfig } from "../dist/server/config.js";

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

/** Create a temporary git repo with an initial commit. Returns real path (resolves symlinks). */
function createTempRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "relay-wt-test-")));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "README.md"), "# Test\n");
  execSync("git add . && git commit -m 'initial'", { cwd: dir, stdio: "pipe" });
  return dir;
}

// =============================================================================
// git.ts — isRelayWorktreePath / resolveWorktreeOrigin
// =============================================================================

describe("isRelayWorktreePath", () => {
  it("matches standard relay worktree paths", () => {
    const home = homedir();
    assert.equal(isRelayWorktreePath(`${home}/.relay/worktrees/8c625689`), true);
    assert.equal(isRelayWorktreePath(`${home}/.relay/worktrees/abcdef01`), true);
    assert.equal(isRelayWorktreePath(`${home}/.relay/worktrees/abcdef01/`), true);
  });

  it("rejects non-worktree paths", () => {
    assert.equal(isRelayWorktreePath("/Users/foo/projects/my-app"), false);
    assert.equal(isRelayWorktreePath("/tmp/test"), false);
    assert.equal(isRelayWorktreePath("/home/user/.relay/uploads/file.png"), false);
  });

  it("rejects paths with non-hex worktree IDs", () => {
    const home = homedir();
    // The regex requires hex chars [a-f0-9]+
    assert.equal(isRelayWorktreePath(`${home}/.relay/worktrees/ZZZZZZZZ`), false);
    assert.equal(isRelayWorktreePath(`${home}/.relay/worktrees/hello-world`), false);
  });
});

describe("resolveWorktreeOrigin", () => {
  let repoDir;
  let worktree;
  const cleanupWorktrees = [];

  beforeEach(() => {
    repoDir = createTempRepo();
  });

  afterEach(() => {
    // Clean up any worktrees we created
    for (const wt of cleanupWorktrees) {
      try {
        removeWorktree(repoDir, wt.worktreePath, wt.branchName);
      } catch {}
    }
    cleanupWorktrees.length = 0;
    try {
      execSync("git worktree prune", { cwd: repoDir, stdio: "pipe" });
    } catch {}
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("resolves worktree origin to the main repo directory", () => {
    worktree = createWorktree(repoDir, "aabbccdd");
    assert.ok(worktree, "worktree should be created");
    cleanupWorktrees.push(worktree);

    const origin = resolveWorktreeOrigin(worktree.worktreePath);
    assert.ok(origin, "origin should be resolved");
    // realpathSync to handle any remaining symlinks
    assert.equal(realpathSync(origin), realpathSync(repoDir));
  });

  it("returns null for non-relay-worktree paths", () => {
    assert.equal(resolveWorktreeOrigin(repoDir), null);
    assert.equal(resolveWorktreeOrigin("/tmp/test"), null);
  });

  it("returns null for nonexistent worktree directory", () => {
    const home = homedir();
    assert.equal(resolveWorktreeOrigin(`${home}/.relay/worktrees/deadbeef`), null);
  });
});

// =============================================================================
// getGitInfo worktree detection (via InstanceManager integration)
// =============================================================================

describe("getGitInfo worktree detection", () => {
  let repoDir;
  const cleanupWorktrees = [];

  beforeEach(() => {
    repoDir = createTempRepo();
  });

  afterEach(() => {
    for (const wt of cleanupWorktrees) {
      try {
        removeWorktree(repoDir, wt.worktreePath, wt.branchName);
      } catch {}
    }
    cleanupWorktrees.length = 0;
    try {
      execSync("git worktree prune", { cwd: repoDir, stdio: "pipe" });
    } catch {}
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("reports isWorktree=true for a git worktree directory", () => {
    const wt = createWorktree(repoDir, "aabbccdd");
    assert.ok(wt, "worktree should be created");
    cleanupWorktrees.push(wt);

    // Create a manager that points at the worktree — createInstance sets gitInfo
    const tempDir = mkdtempSync(join(tmpdir(), "relay-gitinfo-"));
    const config = resolveConfig({
      password: "test",
      logger: noopLogger,
      maxProcesses: 3,
      dbPath: join(tempDir, "sessions.db"),
      claudeDir: join(tempDir, ".claude"),
      codexDir: join(tempDir, ".codex"),
    });
    const manager = new InstanceManager(config);

    // Create instance in the worktree directory
    const info = manager.createInstance({ workingDirectory: wt.worktreePath });
    assert.ok(info.gitInfo, "gitInfo should be present");
    assert.equal(info.gitInfo.isWorktree, true);
    assert.equal(info.gitInfo.branch, wt.branchName);

    manager.stopAll();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("reports isWorktree=false for a normal git repo", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "relay-gitinfo-"));
    const config = resolveConfig({
      password: "test",
      logger: noopLogger,
      maxProcesses: 3,
      dbPath: join(tempDir, "sessions.db"),
      claudeDir: join(tempDir, ".claude"),
      codexDir: join(tempDir, ".codex"),
    });
    const manager = new InstanceManager(config);

    const info = manager.createInstance({ workingDirectory: repoDir });
    assert.ok(info.gitInfo, "gitInfo should be present");
    assert.equal(info.gitInfo.isWorktree, false);
    assert.equal(info.gitInfo.branch, "main");
    assert.equal(info.gitBranch, undefined);
    assert.equal(info.originalDirectory, undefined);

    const instance = manager.instances.get(info.id);
    assert.ok(instance, "internal instance should exist");
    assert.equal(instance.worktreePath, undefined);
    assert.equal(instance.actualCwd, undefined);

    manager.stopAll();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

// =============================================================================
// scanAllSessions worktree path recovery
// =============================================================================

describe("scanAllSessions worktree recovery", () => {
  let repoDir;
  let tempDir;
  const cleanupWorktrees = [];

  beforeEach(() => {
    repoDir = createTempRepo();
    tempDir = mkdtempSync(join(tmpdir(), "relay-scan-wt-"));
  });

  afterEach(() => {
    for (const wt of cleanupWorktrees) {
      try {
        removeWorktree(repoDir, wt.worktreePath, wt.branchName);
      } catch {}
    }
    cleanupWorktrees.length = 0;
    try {
      execSync("git worktree prune", { cwd: repoDir, stdio: "pipe" });
    } catch {}
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("resolves worktree cwd to original directory during JSONL scan", () => {
    const wt = createWorktree(repoDir, "aabbccdd");
    assert.ok(wt, "worktree should be created");
    cleanupWorktrees.push(wt);

    // Simulate a JSONL file whose cwd field is the worktree path
    const claudeDir = join(tempDir, ".claude");
    const encoded = wt.worktreePath.replace(/\//g, "-");
    const projectDir = join(claudeDir, "projects", encoded);
    mkdirSync(projectDir, { recursive: true });

    const sessionId = "00000000-0000-0000-0000-000000000001";
    const jsonlPath = join(projectDir, `${sessionId}.jsonl`);
    const jsonlContent =
      JSON.stringify({
        type: "system",
        cwd: wt.worktreePath,
        timestamp: new Date().toISOString(),
      }) + "\n";
    writeFileSync(jsonlPath, jsonlContent);

    // Create a fresh manager and restore — scanAllSessions should detect the worktree
    const config = resolveConfig({
      password: "test",
      logger: noopLogger,
      maxProcesses: 3,
      dbPath: join(tempDir, "sessions.db"),
      claudeDir,
      codexDir: join(tempDir, ".codex"),
    });
    const manager = new InstanceManager(config);
    manager.restoreAndScan();

    // The instance should have workingDirectory = original repo dir, not the worktree
    const instances = manager.listInstances();
    assert.equal(instances.length, 1, "should have discovered 1 instance");

    const inst = instances[0];
    assert.equal(
      realpathSync(inst.workingDirectory),
      realpathSync(repoDir),
      `workingDirectory should be original repo dir, got: ${inst.workingDirectory}`,
    );
    assert.equal(
      realpathSync(inst.originalDirectory),
      realpathSync(repoDir),
      "originalDirectory should point to original repo dir",
    );
    assert.equal(inst.external, true, "should be external");

    manager.stopAll();
  });

  it("archives gracefully when worktree no longer exists on disk", () => {
    const wt = createWorktree(repoDir, "aabbccdd");
    assert.ok(wt, "worktree should be created");
    const worktreePath = wt.worktreePath;

    // Remove the worktree so resolveWorktreeOrigin can't use git
    removeWorktree(repoDir, wt.worktreePath, wt.branchName);
    assert.ok(!existsSync(worktreePath), "worktree should be removed");

    // Simulate a JSONL file whose cwd field is the now-deleted worktree path
    const claudeDir = join(tempDir, ".claude");
    const encoded = worktreePath.replace(/\//g, "-");
    const projectDir = join(claudeDir, "projects", encoded);
    mkdirSync(projectDir, { recursive: true });

    const sessionId = "00000000-0000-0000-0000-000000000002";
    const jsonlPath = join(projectDir, `${sessionId}.jsonl`);
    const jsonlContent =
      JSON.stringify({
        type: "system",
        cwd: worktreePath,
        timestamp: new Date().toISOString(),
      }) + "\n";
    writeFileSync(jsonlPath, jsonlContent);

    // Create a fresh manager and restore
    const config = resolveConfig({
      password: "test",
      logger: noopLogger,
      maxProcesses: 3,
      dbPath: join(tempDir, "sessions.db"),
      claudeDir,
      codexDir: join(tempDir, ".codex"),
    });
    const manager = new InstanceManager(config);
    manager.restoreAndScan();

    // Session gets discovered but then archived because the working_directory
    // (worktree path) no longer exists and there's no original_directory to fall back to
    const instances = manager.listInstances();
    assert.equal(instances.length, 0, "deleted worktree with no recovery path should be archived");

    manager.stopAll();
  });
});

// =============================================================================
// Archive protection for worktree instances
// =============================================================================

describe("scanAllSessions archive protection", () => {
  let repoDir;
  let tempDir;
  const cleanupWorktrees = [];

  beforeEach(() => {
    repoDir = createTempRepo();
    tempDir = mkdtempSync(join(tmpdir(), "relay-archive-wt-"));
  });

  afterEach(() => {
    for (const wt of cleanupWorktrees) {
      try {
        removeWorktree(repoDir, wt.worktreePath, wt.branchName);
      } catch {}
    }
    cleanupWorktrees.length = 0;
    try {
      execSync("git worktree prune", { cwd: repoDir, stdio: "pipe" });
    } catch {}
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not archive worktree instances when original_directory exists", () => {
    const wt = createWorktree(repoDir, "aabbccdd");
    assert.ok(wt, "worktree should be created");
    cleanupWorktrees.push(wt);

    const claudeDir = join(tempDir, ".claude");
    const encoded = wt.worktreePath.replace(/\//g, "-");
    const projectDir = join(claudeDir, "projects", encoded);
    mkdirSync(projectDir, { recursive: true });

    const sessionId = "00000000-0000-0000-0000-000000000003";
    const jsonlPath = join(projectDir, `${sessionId}.jsonl`);
    writeFileSync(
      jsonlPath,
      JSON.stringify({
        type: "system",
        cwd: wt.worktreePath,
        timestamp: new Date().toISOString(),
      }) + "\n",
    );

    const config = resolveConfig({
      password: "test",
      logger: noopLogger,
      maxProcesses: 3,
      dbPath: join(tempDir, "sessions.db"),
      claudeDir,
      codexDir: join(tempDir, ".codex"),
    });

    // First scan discovers the session and resolves worktree
    const manager1 = new InstanceManager(config);
    manager1.restoreAndScan();

    let instances = manager1.listInstances();
    assert.equal(instances.length, 1);
    manager1.stopAll();

    // Now remove the worktree (simulating cleanup) — the working_directory
    // should now point to the original repo dir (which still exists)
    removeWorktree(repoDir, wt.worktreePath, wt.branchName);
    cleanupWorktrees.length = 0; // Already cleaned up

    // Second scan should NOT archive the instance because original_directory exists
    const manager2 = new InstanceManager(config);
    manager2.restoreAndScan();

    instances = manager2.listInstances();
    assert.equal(instances.length, 1, "instance should survive re-scan after worktree removal");
    manager2.stopAll();
  });
});
