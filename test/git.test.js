import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import {
  isGitRepo,
  getRepoRoot,
  getCurrentBranch,
  getRemoteUrl,
  isRelayWorktreePath,
  createWorktree,
  removeWorktree,
  isWorktreeDirty,
  hasWorktreeChanges,
  commitAll,
} from "../dist/core/git.js";

// Helper: create a temp git repo with an initial commit
function createTestRepo() {
  const dir = mkdtempSync(join(tmpdir(), "relay-git-test-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "file.txt"), "hello");
  execSync("git add -A && git commit -m 'init'", { cwd: dir, stdio: "pipe" });
  return dir;
}

describe("isGitRepo", () => {
  let repoDir;
  let plainDir;

  beforeEach(() => {
    repoDir = createTestRepo();
    plainDir = mkdtempSync(join(tmpdir(), "relay-git-test-plain-"));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
    rmSync(plainDir, { recursive: true, force: true });
  });

  it("returns true for a git repository", () => {
    assert.equal(isGitRepo(repoDir), true);
  });

  it("returns true for a subdirectory within a git repo", () => {
    const sub = join(repoDir, "subdir");
    mkdirSync(sub);
    assert.equal(isGitRepo(sub), true);
  });

  it("returns false for a non-git directory", () => {
    assert.equal(isGitRepo(plainDir), false);
  });

  it("returns false for a nonexistent directory", () => {
    assert.equal(isGitRepo("/tmp/nonexistent-relay-test-dir-xyz"), false);
  });
});

describe("getRepoRoot", () => {
  let repoDir;

  beforeEach(() => {
    repoDir = createTestRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns the repo root from the root directory", () => {
    // realpath to resolve macOS /private/tmp symlinks
    const expected = execSync("git rev-parse --show-toplevel", {
      cwd: repoDir,
      encoding: "utf-8",
    }).trim();
    assert.equal(getRepoRoot(repoDir), expected);
  });

  it("returns the repo root from a subdirectory", () => {
    const sub = join(repoDir, "nested");
    mkdirSync(sub);
    const root = getRepoRoot(sub);
    assert.ok(root);
    assert.equal(getRepoRoot(repoDir), root);
  });

  it("returns null for a non-git directory", () => {
    const plain = mkdtempSync(join(tmpdir(), "relay-git-test-"));
    try {
      assert.equal(getRepoRoot(plain), null);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("getCurrentBranch", () => {
  let repoDir;

  beforeEach(() => {
    repoDir = createTestRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("returns the default branch name", () => {
    const branch = getCurrentBranch(repoDir);
    assert.ok(branch);
    // Could be 'main' or 'master' depending on git config
    assert.ok(typeof branch === "string" && branch.length > 0);
  });

  it("returns the correct branch after checkout", () => {
    execSync("git checkout -b test-branch", { cwd: repoDir, stdio: "pipe" });
    assert.equal(getCurrentBranch(repoDir), "test-branch");
  });

  it("returns null for a non-git directory", () => {
    const plain = mkdtempSync(join(tmpdir(), "relay-git-test-"));
    try {
      assert.equal(getCurrentBranch(plain), null);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("getRemoteUrl", () => {
  let repoDir;

  beforeEach(() => {
    repoDir = createTestRepo();
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("normalizes SSH URLs to HTTPS", () => {
    execSync("git remote add origin git@github.com:owner/repo.git", {
      cwd: repoDir,
      stdio: "pipe",
    });
    assert.equal(getRemoteUrl(repoDir), "https://github.com/owner/repo");
  });

  it("strips .git suffix from HTTPS URLs", () => {
    execSync("git remote add origin https://github.com/owner/repo.git", {
      cwd: repoDir,
      stdio: "pipe",
    });
    assert.equal(getRemoteUrl(repoDir), "https://github.com/owner/repo");
  });

  it("returns HTTPS URL as-is when no .git suffix", () => {
    execSync("git remote add origin https://github.com/owner/repo", {
      cwd: repoDir,
      stdio: "pipe",
    });
    assert.equal(getRemoteUrl(repoDir), "https://github.com/owner/repo");
  });

  it("returns null when no remote configured", () => {
    assert.equal(getRemoteUrl(repoDir), null);
  });

  it("returns null for a non-git directory", () => {
    const plain = mkdtempSync(join(tmpdir(), "relay-git-test-"));
    try {
      assert.equal(getRemoteUrl(plain), null);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("isRelayWorktreePath", () => {
  it("matches valid relay worktree paths", () => {
    assert.equal(isRelayWorktreePath("/home/user/.relay/worktrees/abcd1234"), true);
    assert.equal(isRelayWorktreePath("/Users/me/.relay/worktrees/deadbeef/"), true);
  });

  it("rejects non-relay paths", () => {
    assert.equal(isRelayWorktreePath("/home/user/projects/myapp"), false);
    assert.equal(isRelayWorktreePath("/home/user/.relay/uploads/abcd1234"), false);
    assert.equal(isRelayWorktreePath("/home/user/.relay/worktrees/"), false);
  });
});

describe("worktree lifecycle", () => {
  let repoDir;
  let worktreeResult;

  beforeEach(() => {
    repoDir = createTestRepo();
  });

  afterEach(() => {
    // Clean up worktree if it was created
    if (worktreeResult) {
      try {
        removeWorktree(repoDir, worktreeResult.worktreePath, worktreeResult.branchName);
      } catch {
        // ignore
      }
    }
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("createWorktree creates a worktree and branch", () => {
    worktreeResult = createWorktree(repoDir, "test1234");
    assert.ok(worktreeResult);
    assert.ok(worktreeResult.worktreePath.includes("test1234"));
    assert.equal(worktreeResult.branchName, "relay/test1234");

    // Verify the worktree is a valid git repo
    assert.equal(isGitRepo(worktreeResult.worktreePath), true);
    assert.equal(getCurrentBranch(worktreeResult.worktreePath), "relay/test1234");
  });

  it("isWorktreeDirty detects clean vs dirty state", () => {
    worktreeResult = createWorktree(repoDir, "dirty1234");
    assert.ok(worktreeResult);

    // Clean initially
    assert.equal(isWorktreeDirty(worktreeResult.worktreePath), false);

    // Make it dirty
    writeFileSync(join(worktreeResult.worktreePath, "new-file.txt"), "dirty");
    assert.equal(isWorktreeDirty(worktreeResult.worktreePath), true);
  });

  it("hasWorktreeChanges detects committed changes", () => {
    worktreeResult = createWorktree(repoDir, "changes1");
    assert.ok(worktreeResult);

    // No changes yet
    assert.equal(hasWorktreeChanges(worktreeResult.worktreePath, repoDir), false);

    // Add a commit in the worktree
    writeFileSync(join(worktreeResult.worktreePath, "new.txt"), "content");
    execSync("git add -A && git commit -m 'worktree change'", {
      cwd: worktreeResult.worktreePath,
      stdio: "pipe",
    });

    assert.equal(hasWorktreeChanges(worktreeResult.worktreePath, repoDir), true);
  });

  it("commitAll stages and commits all changes", () => {
    worktreeResult = createWorktree(repoDir, "commit12");
    assert.ok(worktreeResult);

    writeFileSync(join(worktreeResult.worktreePath, "file.txt"), "modified");
    writeFileSync(join(worktreeResult.worktreePath, "new.txt"), "added");

    const result = commitAll(worktreeResult.worktreePath, "test commit");
    assert.deepEqual(result, { success: true });

    // Should be clean after commit
    assert.equal(isWorktreeDirty(worktreeResult.worktreePath), false);
  });

  it("commitAll returns error when nothing to commit", () => {
    worktreeResult = createWorktree(repoDir, "empty123");
    assert.ok(worktreeResult);

    const result = commitAll(worktreeResult.worktreePath, "empty commit");
    assert.equal(result.success, false);
  });

  it("removeWorktree cleans up worktree and branch", () => {
    worktreeResult = createWorktree(repoDir, "remove12");
    assert.ok(worktreeResult);

    removeWorktree(repoDir, worktreeResult.worktreePath, worktreeResult.branchName);

    // Branch should be gone
    const branches = execSync("git branch", { cwd: repoDir, encoding: "utf-8" });
    assert.ok(!branches.includes("relay/remove12"));

    // Prevent afterEach from trying to clean up again
    worktreeResult = null;
  });
});
