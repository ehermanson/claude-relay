/**
 * Git utility functions for worktree isolation.
 *
 * All functions use execSync following the existing pattern used for
 * `which claude`, `ps`, and `lsof` elsewhere in the codebase.
 */

import { execSync, execFileSync, execFile as execFileCb } from "child_process";
import { existsSync, openSync, readSync, closeSync, readFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import { promisify } from "util";

import type { FileChange } from "./types.js";

const WORKTREE_BASE = join(homedir(), ".relay", "worktrees");
const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const RELAY_GIT_FALLBACK_NAME = "Relay";
const RELAY_GIT_FALLBACK_EMAIL = "relay@local";

/** Check if a file is likely binary by reading the first 8KB and looking for null bytes. */
function isBinaryFile(absPath: string): boolean {
  try {
    const fd = openSync(absPath, "r");
    const buf = Buffer.alloc(8192);
    const bytesRead = readSync(fd, buf, 0, 8192, 0);
    closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function normalizeBranchName(branch: string): string | null {
  const trimmed = branch.trim();
  if (!trimmed || trimmed === "HEAD") return null;
  return trimmed;
}

/** Pattern matching ~/.relay/worktrees/<name> paths (instance and space worktrees) */
const RELAY_WORKTREE_RE = /[/\\]\.relay[/\\]worktrees[/\\][^/\\]+\/?$/;

/**
 * Check if a directory path is a relay-managed worktree.
 */
export function isRelayWorktreePath(dir: string): boolean {
  return RELAY_WORKTREE_RE.test(dir);
}

/**
 * For a relay worktree path, resolve the original repository directory
 * by reading git's common-dir (which points to the main repo's .git/).
 * Returns null if the worktree doesn't exist on disk or git can't resolve it.
 */
export function resolveWorktreeOrigin(worktreePath: string): string | null {
  if (!isRelayWorktreePath(worktreePath)) return null;
  if (!existsSync(worktreePath)) return null;

  try {
    const opts = { cwd: worktreePath, timeout: 2000, encoding: "utf8" as const };
    const gitCommonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], opts).trim();
    // git-common-dir returns the main repo's .git dir (may be relative)
    const resolved = resolve(worktreePath, gitCommonDir);
    // Parent of .git is the repo root
    return dirname(resolved);
  } catch {
    return null;
  }
}

/**
 * Initialize a new git repository with an initial empty commit.
 * The commit ensures HEAD is valid for worktree creation and other git operations.
 */
export function gitInit(dir: string): void {
  const opts = { cwd: dir, timeout: 10000, stdio: "pipe" as const };
  execFileSync("git", ["init"], opts);

  try {
    execFileSync("git", ["commit", "--allow-empty", "-m", "Initial commit"], opts);
  } catch (error) {
    if (!isMissingGitIdentityError(error)) {
      throw error;
    }

    execFileSync(
      "git",
      [
        "-c",
        `user.name=${RELAY_GIT_FALLBACK_NAME}`,
        "-c",
        `user.email=${RELAY_GIT_FALLBACK_EMAIL}`,
        "commit",
        "--allow-empty",
        "-m",
        "Initial commit",
      ],
      opts,
    );
  }
}

function isMissingGitIdentityError(error: unknown): boolean {
  const stderr =
    (error as { stderr?: Buffer })?.stderr?.toString("utf8") ??
    (error as { stdout?: Buffer })?.stdout?.toString("utf8") ??
    "";

  return (
    stderr.includes("Author identity unknown") ||
    stderr.includes("Committer identity unknown") ||
    stderr.includes("unable to auto-detect email address") ||
    stderr.includes("no email was given and auto-detection is disabled")
  );
}

/**
 * Check if a directory is inside a git working tree.
 */
export function isGitRepo(dir: string): boolean {
  try {
    const result = execSync("git rev-parse --is-inside-work-tree", {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    })
      .toString()
      .trim();
    return result === "true";
  } catch {
    return false;
  }
}

/**
 * Get the GitHub/GitLab URL for a repository by reading git remote origin.
 * Returns null if not a git repo or no remote URL found.
 */
export function getRemoteUrl(dir: string): string | null {
  try {
    const raw = execSync("git remote get-url origin", {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    })
      .toString()
      .trim();
    if (!raw) return null;
    // Normalize SSH URLs (git@github.com:owner/repo.git) to HTTPS
    const sshMatch = raw.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2]}`;
    // Strip trailing .git from HTTPS URLs
    return raw.replace(/\.git$/, "");
  } catch {
    return null;
  }
}

/**
 * Get the root directory of the git repository.
 */
export function getRepoRoot(dir: string): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/**
 * Get the current branch name.
 */
export function getCurrentBranch(dir: string): string | null {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    }).toString();
    return normalizeBranchName(branch);
  } catch {
    return null;
  }
}

function hasHeadCommit(dir: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: dir,
      timeout: 3000,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the default branch for a repository (main/master).
 * Tries symbolic-ref first, falls back to main/master heuristic.
 */
export function getDefaultBranch(dir: string): string | null {
  // Try symbolic-ref for remote HEAD
  try {
    const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    })
      .toString()
      .trim();
    // refs/remotes/origin/main → main
    const branch = ref.replace(/^refs\/remotes\/origin\//, "");
    if (branch) return branch;
  } catch {
    // No remote HEAD configured — fall through
  }

  // Heuristic: check if main or master exists
  for (const candidate of ["main", "master"]) {
    try {
      execSync(`git rev-parse --verify ${candidate}`, {
        cwd: dir,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 3000,
      });
      return candidate;
    } catch {
      // branch doesn't exist
    }
  }

  return null;
}

/**
 * Get the unified diff of a branch vs the default branch (committed changes only).
 */
export function getBranchDiff(
  repoRoot: string,
  branchName: string,
  defaultBranch: string,
): string | null {
  try {
    const mergeBase = execFileSync("git", ["merge-base", defaultBranch, branchName], {
      cwd: repoRoot,
      timeout: 5000,
      encoding: "utf8" as const,
    }).trim();
    return execFileSync("git", ["diff", mergeBase, branchName], {
      cwd: repoRoot,
      timeout: 10000,
      encoding: "utf8" as const,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * Get the unified diff of a worktree's full state (committed + uncommitted)
 * vs the merge-base with the default branch.
 *
 * This captures everything the agent has done in the worktree, whether
 * committed or still in the working tree.
 */
export function getWorktreeDiff(worktreePath: string, defaultBranch: string): string | null {
  try {
    // Find the merge-base between the default branch and the worktree's HEAD
    const mergeBase = execFileSync("git", ["merge-base", defaultBranch, "HEAD"], {
      cwd: worktreePath,
      timeout: 5000,
      encoding: "utf8" as const,
    }).trim();

    // Diff the merge-base against the working tree (includes uncommitted changes).
    // We combine committed-on-branch diffs + staged + unstaged.
    return execFileSync("git", ["diff", mergeBase], {
      cwd: worktreePath,
      timeout: 10000,
      encoding: "utf8" as const,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * Create a git worktree for an isolated instance.
 *
 * Creates a new branch `relay/<shortId>` at HEAD and checks it out
 * in `~/.relay/worktrees/<shortId>/`.
 *
 * Returns the worktree path and branch name, or null on failure.
 */
export function createWorktree(
  repoRoot: string,
  shortId: string,
): { worktreePath: string; branchName: string } | null {
  const worktreePath = join(WORKTREE_BASE, shortId);
  const branchName = `relay/${shortId}`;

  try {
    execSync(`git worktree add -b "${branchName}" "${worktreePath}" HEAD`, {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
    });
    return { worktreePath, branchName };
  } catch {
    return null;
  }
}

/**
 * Check if a worktree has any changes (uncommitted or committed) vs the original branch.
 * Returns true if:
 *   - The worktree has uncommitted changes (dirty), OR
 *   - The worktree branch has commits ahead of the original branch
 * Returns true on errors (safe default — assume changes exist).
 */
export function hasWorktreeChanges(worktreePath: string, originalDirectory: string): boolean {
  // Check uncommitted changes first (fast)
  if (isWorktreeDirty(worktreePath)) return true;

  // Check if worktree branch has commits not in the original branch
  try {
    const originalBranch = getCurrentBranch(originalDirectory);
    if (!originalBranch) return true; // can't determine, assume changes

    const count = execSync(`git rev-list --count "${originalBranch}..HEAD"`, {
      cwd: worktreePath,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    })
      .toString()
      .trim();

    return parseInt(count, 10) > 0;
  } catch {
    return true; // can't determine, assume changes
  }
}

/**
 * Check if a worktree has uncommitted changes.
 */
export function isWorktreeDirty(worktreePath: string): boolean {
  try {
    const output = execSync("git status --porcelain", {
      cwd: worktreePath,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    })
      .toString()
      .trim();
    return output.length > 0;
  } catch {
    return true; // Assume dirty if we can't check
  }
}

/**
 * Merge a worktree branch into whatever branch is checked out in the primary worktree.
 *
 * On conflict: runs `git merge --abort` and returns an error.
 * Caller should check `isWorktreeDirty()` first to reject dirty worktrees.
 */
export function mergeWorktreeBranch(
  repoRoot: string,
  branchName: string,
): { success: true } | { success: false; error: string } {
  try {
    execSync(`git merge "${branchName}" --no-edit`, {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
    });
    return { success: true };
  } catch (err) {
    // Merge failed (conflict or other error) — abort to leave repo clean
    try {
      execSync("git merge --abort", {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10000,
      });
    } catch {
      // abort may fail if merge didn't start — ignore
    }

    // Extract a human-readable message from the git output
    const stderr =
      (err as { stderr?: Buffer })?.stderr?.toString().trim() ||
      (err as { stdout?: Buffer })?.stdout?.toString().trim() ||
      "";
    let message: string;
    if (stderr.includes("CONFLICT")) {
      message = "CONFLICT";
    } else if (stderr) {
      message = stderr;
    } else {
      message = err instanceof Error ? err.message : "Unknown merge error";
    }
    return { success: false, error: message };
  }
}

/**
 * Squash-merge a branch into the current branch of repoRoot.
 *
 * Stages all branch changes as a single commit with the given message.
 * On failure: runs `git reset --hard HEAD && git clean -fd` to restore the
 * repo to its pre-merge state, including removal of any new files the
 * squashed branch introduced.
 *
 * `git merge --squash` does not create a MERGE_HEAD, so `git merge --abort`
 * is ineffective — the reset+clean approach is the reliable cleanup path.
 */
export function squashMergeBranch(
  repoRoot: string,
  branchName: string,
  commitMessage: string,
): { success: true } | { success: false; error: string } {
  const opts = { cwd: repoRoot, stdio: "pipe" as const, timeout: 30000 };

  // Step 1: squash-merge (stages changes but does not commit)
  try {
    execFileSync("git", ["merge", "--squash", branchName], opts);
  } catch (err) {
    // Squash itself failed (conflict or other error) — clean up staged changes
    resetHard(repoRoot);
    return { success: false, error: extractMergeError(err) };
  }

  // Step 2: commit the staged squash
  try {
    try {
      execFileSync("git", ["commit", "-m", commitMessage], opts);
    } catch (error) {
      if (!isMissingGitIdentityError(error)) {
        throw error;
      }
      execFileSync(
        "git",
        [
          "-c",
          `user.name=${RELAY_GIT_FALLBACK_NAME}`,
          "-c",
          `user.email=${RELAY_GIT_FALLBACK_EMAIL}`,
          "commit",
          "-m",
          commitMessage,
        ],
        opts,
      );
    }
    return { success: true };
  } catch (err) {
    // Commit failed — reset so the main workspace is not left dirty
    resetHard(repoRoot);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Squash commit failed",
    };
  }
}

/**
 * Reset the working tree to HEAD and remove any untracked files/directories.
 *
 * `git reset --hard` handles tracked content (staged + modified files), but
 * a squash-merge that introduces new files may leave them untracked after the
 * reset if they weren't fully indexed. `git clean -fd` catches those.
 *
 * Safe to call when the workspace was verified clean before the operation.
 */
function resetHard(repoRoot: string): void {
  const opts = { cwd: repoRoot, stdio: "pipe" as const, timeout: 10000 };
  try {
    execFileSync("git", ["reset", "--hard", "HEAD"], opts);
  } catch {
    // best-effort
  }
  try {
    execFileSync("git", ["clean", "-fd"], opts);
  } catch {
    // best-effort
  }
}

/** Extract a human-readable error from a git merge failure. */
function extractMergeError(err: unknown): string {
  const stderr =
    (err as { stderr?: Buffer })?.stderr?.toString().trim() ||
    (err as { stdout?: Buffer })?.stdout?.toString().trim() ||
    "";
  if (stderr.includes("CONFLICT")) return "CONFLICT";
  if (stderr) return stderr;
  return err instanceof Error ? err.message : "Unknown merge error";
}

/**
 * Stage all changes and commit in a worktree directory.
 * Safe for relay worktrees since they are isolated — everything in them is Claude's work.
 */
export function commitAll(
  worktreePath: string,
  message: string,
): { success: true } | { success: false; error: string } {
  try {
    const opts = { cwd: worktreePath, stdio: "pipe" as const, timeout: 30000 };
    execFileSync("git", ["add", "-A"], opts);
    try {
      execFileSync("git", ["commit", "-m", message], opts);
    } catch (error) {
      if (!isMissingGitIdentityError(error)) {
        throw error;
      }

      execFileSync(
        "git",
        [
          "-c",
          `user.name=${RELAY_GIT_FALLBACK_NAME}`,
          "-c",
          `user.email=${RELAY_GIT_FALLBACK_EMAIL}`,
          "commit",
          "-m",
          message,
        ],
        opts,
      );
    }
    return { success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown commit error";
    return { success: false, error: errorMessage };
  }
}

/**
 * Remove a git worktree and optionally its branch.
 *
 * Safe to call when the worktree or branch has already been removed.
 * Pass `keepBranch: true` to preserve the branch for recoverability.
 */
export function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  branchName: string,
  opts?: { keepBranch?: boolean },
): void {
  // Remove the worktree
  try {
    execSync(`git worktree remove --force "${worktreePath}"`, {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000,
    });
  } catch {
    // Worktree may already be gone — prune stale refs
    try {
      execSync("git worktree prune", {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10000,
      });
    } catch {
      // ignore
    }
  }

  // Delete the branch unless caller wants to keep it
  if (!opts?.keepBranch) {
    try {
      execSync(`git branch -D "${branchName}"`, {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 5000,
      });
    } catch {
      // Branch may already be gone — ignore
    }
  }
}

/**
 * Find the commit hash that was HEAD at or before the given timestamp.
 * Used to establish a diff baseline for a session's lifetime.
 */
function getBaseCommit(cwd: string, beforeTimestamp: number): string | null {
  if (!hasHeadCommit(cwd)) return null;
  try {
    const isoDate = new Date(beforeTimestamp).toISOString();
    const hash = execFileSync("git", ["log", "--before=" + isoDate, "-1", "--format=%H"], {
      cwd,
      timeout: 3000,
      encoding: "utf8" as const,
    }).trim();
    return hash || null;
  } catch {
    return null;
  }
}

/**
 * Get per-file diff stats (additions/deletions) for tracked files.
 *
 * Diffs the working tree against a base ref that captures all changes since
 * the session started:
 * - Worktree instances: merge-base with the original branch
 * - Non-worktree: commit that was HEAD when the session was created
 * - Fallback: HEAD (uncommitted changes only)
 *
 * Enriches the provided FileChange entries in-place with additions/deletions.
 */
export function enrichDiffStats(
  cwd: string,
  files: Map<string, FileChange>,
  opts?: { originalBranch?: string; sessionCreatedAt?: number },
): void {
  try {
    const repoRoot = getRepoRoot(cwd);
    if (!repoRoot) return;

    // Determine the base ref to diff against
    let baseRef = hasHeadCommit(cwd) ? "HEAD" : EMPTY_TREE_HASH;
    if (opts?.originalBranch) {
      // Worktree: diff against merge-base with original branch
      try {
        baseRef = execFileSync("git", ["merge-base", opts.originalBranch, "HEAD"], {
          cwd,
          timeout: 3000,
          encoding: "utf8" as const,
        }).trim();
      } catch {
        // fall back
      }
    } else if (opts?.sessionCreatedAt) {
      // Non-worktree: diff against the commit that was HEAD when session started
      const base = getBaseCommit(cwd, opts.sessionCreatedAt);
      if (base) baseRef = base;
    }

    const output = execFileSync("git", ["diff", baseRef, "--numstat"], {
      cwd,
      timeout: 5000,
      encoding: "utf8" as const,
    }).trim();

    if (output) {
      for (const line of output.split("\n")) {
        if (!line) continue;
        const parts = line.split("\t");
        if (parts.length < 3 || parts[0] === "-") continue; // binary file
        const absPath = join(repoRoot, parts[2]);
        const file = files.get(absPath);
        if (file) {
          file.additions = parseInt(parts[0], 10);
          file.deletions = parseInt(parts[1], 10);
        }
      }
    }

    // Also count lines in untracked files that are in our file map
    const untracked = getUntrackedFiles(cwd);
    for (const relPath of untracked) {
      const absPath = join(repoRoot, relPath);
      const file = files.get(absPath);
      if (file) {
        try {
          if (isBinaryFile(absPath)) continue;
          const content = readFileSync(absPath, "utf8");
          const lineCount =
            content.length === 0
              ? 0
              : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
          file.additions = lineCount;
          file.deletions = 0;
        } catch {
          // skip unreadable files
        }
      }
    }
  } catch {
    // git not available or not a repo — silently skip
  }
}

// ---------------------------------------------------------------------------
// Async variants — used to defer git I/O out of the synchronous hydration path
// ---------------------------------------------------------------------------

const execFileAsync = promisify(execFileCb);

export async function getCurrentBranchAsync(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: dir,
      timeout: 5000,
    });
    return normalizeBranchName(stdout);
  } catch {
    return null;
  }
}

export async function getGitInfoAsync(
  dir: string,
): Promise<{ branch: string; isWorktree: boolean } | null> {
  try {
    const opts = { cwd: dir, timeout: 2000 };
    const [branchResult, gitDirResult, commonDirResult] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], opts),
      execFileAsync("git", ["rev-parse", "--git-dir"], opts),
      execFileAsync("git", ["rev-parse", "--git-common-dir"], opts),
    ]);
    const branch = normalizeBranchName(branchResult.stdout);
    if (!branch) return null;
    const gitDir = resolve(dir, gitDirResult.stdout.trim());
    const gitCommonDir = resolve(dir, commonDirResult.stdout.trim());
    return { branch, isWorktree: gitDir !== gitCommonDir };
  } catch {
    return null;
  }
}

export async function hasWorktreeChangesAsync(
  worktreePath: string,
  originalDirectory: string,
): Promise<boolean> {
  // Check uncommitted changes first (fast)
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: worktreePath,
      timeout: 10000,
    });
    if (stdout.trim().length > 0) return true;
  } catch {
    return true;
  }

  // Check if worktree branch has commits not in the original branch
  try {
    const originalBranch = await getCurrentBranchAsync(originalDirectory);
    if (!originalBranch) return true;

    const { stdout } = await execFileAsync(
      "git",
      ["rev-list", "--count", `${originalBranch}..HEAD`],
      { cwd: worktreePath, timeout: 5000 },
    );
    return parseInt(stdout.trim(), 10) > 0;
  } catch {
    return true;
  }
}

/**
 * List untracked files in the repo (files not known to git).
 * Returns paths relative to the repo root.
 */
function getUntrackedFiles(cwd: string): string[] {
  try {
    const output = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd,
      timeout: 5000,
      encoding: "utf8" as const,
    }).trim();
    if (!output) return [];
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Generate a unified diff patch for an untracked (new) file.
 * Mimics git diff output format so it can be concatenated with tracked diffs.
 * Returns null for binary files or unreadable files.
 */
function diffForNewFile(repoRoot: string, relPath: string): string | null {
  try {
    const absPath = join(repoRoot, relPath);
    if (isBinaryFile(absPath)) {
      // Emit a binary stub like git does
      return [
        `diff --git a/${relPath} b/${relPath}`,
        "new file mode 100644",
        `Binary files /dev/null and b/${relPath} differ`,
        "",
      ].join("\n");
    }
    const content = readFileSync(absPath, "utf8");

    // Empty file — valid diff with no hunks
    if (content.length === 0) {
      return [
        `diff --git a/${relPath} b/${relPath}`,
        "new file mode 100644",
        "--- /dev/null",
        `+++ b/${relPath}`,
        "",
      ].join("\n");
    }

    const lines = content.split("\n");
    const hasTrailingNewline = content.endsWith("\n");
    const displayLines = hasTrailingNewline ? lines.slice(0, -1) : lines;
    const count = displayLines.length;

    const header = [
      `diff --git a/${relPath} b/${relPath}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ b/${relPath}`,
      `@@ -0,0 +1,${count} @@`,
    ];
    const body = displayLines.map((l) => `+${l}`);
    if (!hasTrailingNewline) body.push("\\ No newline at end of file");
    return header.join("\n") + "\n" + body.join("\n") + "\n";
  } catch {
    return null;
  }
}

/**
 * Resolve the base ref for diffing an instance's changes.
 * Reuses the same logic as enrichDiffStats:
 * - Worktree: merge-base with original branch
 * - Non-worktree: commit at session start
 * - Fallback: HEAD
 */
function resolveBaseRef(
  cwd: string,
  opts?: { originalBranch?: string; sessionCreatedAt?: number },
): string {
  let baseRef = hasHeadCommit(cwd) ? "HEAD" : EMPTY_TREE_HASH;
  if (opts?.originalBranch) {
    try {
      baseRef = execFileSync("git", ["merge-base", opts.originalBranch, "HEAD"], {
        cwd,
        timeout: 3000,
        encoding: "utf8" as const,
      }).trim();
    } catch {
      // fall back
    }
  } else if (opts?.sessionCreatedAt) {
    const base = getBaseCommit(cwd, opts.sessionCreatedAt);
    if (base) baseRef = base;
  }
  return baseRef;
}

/**
 * Get the unified diff for all changed files relative to the session baseline.
 * Includes both tracked modifications and untracked (new) files.
 * Returns the raw `git diff` output string, or null if not a git repo.
 */
export function getFullDiff(
  cwd: string,
  opts?: { originalBranch?: string; sessionCreatedAt?: number },
): string | null {
  try {
    const repoRoot = getRepoRoot(cwd);
    if (!repoRoot) return null;
    const baseRef = resolveBaseRef(cwd, opts);
    let diff = execFileSync("git", ["diff", baseRef], {
      cwd,
      timeout: 10000,
      encoding: "utf8" as const,
      maxBuffer: 10 * 1024 * 1024,
    });

    // Append diffs for untracked (new) files
    const untracked = getUntrackedFiles(cwd);
    for (const relPath of untracked) {
      const patch = diffForNewFile(repoRoot, relPath);
      if (patch) diff += patch;
    }

    return diff;
  } catch {
    return null;
  }
}

/**
 * Get the unified diff for a single file relative to the session baseline.
 * Handles both tracked files and untracked (new) files.
 * Returns the raw `git diff` output string, or null if not a git repo.
 */
export function getFileDiff(
  cwd: string,
  filePath: string,
  opts?: { originalBranch?: string; sessionCreatedAt?: number },
): string | null {
  try {
    const repoRoot = getRepoRoot(cwd);
    if (!repoRoot) return null;
    const baseRef = resolveBaseRef(cwd, opts);
    const diff = execFileSync("git", ["diff", baseRef, "--", filePath], {
      cwd,
      timeout: 10000,
      encoding: "utf8" as const,
      maxBuffer: 10 * 1024 * 1024,
    });

    // If git diff returned nothing, check if it's an untracked file
    if (!diff.trim()) {
      const relPath = filePath.startsWith(repoRoot)
        ? filePath.slice(repoRoot.length + 1)
        : filePath;
      const untracked = getUntrackedFiles(cwd);
      if (untracked.includes(relPath)) {
        return diffForNewFile(repoRoot, relPath) ?? "";
      }
    }

    return diff;
  } catch {
    return null;
  }
}

async function getBaseCommitAsync(cwd: string, beforeTimestamp: number): Promise<string | null> {
  if (!(await hasHeadCommitAsync(cwd))) return null;
  try {
    const isoDate = new Date(beforeTimestamp).toISOString();
    const { stdout } = await execFileAsync(
      "git",
      ["log", "--before=" + isoDate, "-1", "--format=%H"],
      { cwd, timeout: 3000 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function getRepoRootAsync(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function hasHeadCommitAsync(dir: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: dir,
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

export async function enrichDiffStatsAsync(
  cwd: string,
  files: Map<string, FileChange>,
  opts?: { originalBranch?: string; sessionCreatedAt?: number },
): Promise<void> {
  try {
    const repoRoot = await getRepoRootAsync(cwd);
    if (!repoRoot) return;

    let baseRef = (await hasHeadCommitAsync(cwd)) ? "HEAD" : EMPTY_TREE_HASH;
    if (opts?.originalBranch) {
      try {
        const { stdout } = await execFileAsync("git", ["merge-base", opts.originalBranch, "HEAD"], {
          cwd,
          timeout: 3000,
        });
        baseRef = stdout.trim();
      } catch {
        // fall back
      }
    } else if (opts?.sessionCreatedAt) {
      const base = await getBaseCommitAsync(cwd, opts.sessionCreatedAt);
      if (base) baseRef = base;
    }

    const { stdout } = await execFileAsync("git", ["diff", baseRef, "--numstat"], {
      cwd,
      timeout: 5000,
    });
    const output = stdout.trim();

    if (output) {
      for (const line of output.split("\n")) {
        if (!line) continue;
        const parts = line.split("\t");
        if (parts.length < 3 || parts[0] === "-") continue;
        const absPath = join(repoRoot, parts[2]);
        const file = files.get(absPath);
        if (file) {
          file.additions = parseInt(parts[0], 10);
          file.deletions = parseInt(parts[1], 10);
        }
      }
    }

    // Also count lines in untracked files that are in our file map
    const untracked = getUntrackedFiles(cwd);
    for (const relPath of untracked) {
      const absPath = join(repoRoot, relPath);
      const file = files.get(absPath);
      if (file) {
        try {
          if (isBinaryFile(absPath)) continue;
          const content = readFileSync(absPath, "utf8");
          const lineCount =
            content.length === 0
              ? 0
              : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
          file.additions = lineCount;
          file.deletions = 0;
        } catch {
          // skip unreadable files
        }
      }
    }
  } catch {
    // git not available or not a repo — silently skip
  }
}

// ─── Branch Management ────────────────────────────────────────────────────

/**
 * Detect the primary remote name for a repo directory.
 * Prefers "origin" if it exists, otherwise uses the first remote.
 */
export function getPrimaryRemote(dir: string): string {
  try {
    const output = execFileSync("git", ["remote"], {
      cwd: dir,
      timeout: 3000,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const remotes = output.trim().split("\n").filter(Boolean);
    if (remotes.includes("origin")) return "origin";
    return remotes[0] || "origin";
  } catch {
    return "origin";
  }
}

/**
 * List local and remote branches, marking the current branch.
 */
export function listBranches(dir: string): {
  local: string[];
  remote: string[];
  current: string | null;
} {
  let current: string | null = null;
  const local: string[] = [];
  const remote: string[] = [];

  try {
    const localOutput = execFileSync("git", ["branch", "--no-color"], {
      cwd: dir,
      timeout: 5000,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    for (const line of localOutput.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (line.startsWith("* ")) {
        const branch = trimmed.slice(2);
        current = branch.startsWith("(") ? null : branch;
        if (current) local.push(current);
      } else if (line.startsWith("+ ")) {
        // Branch checked out in another worktree — include it but don't mark as current
        const branch = trimmed.slice(2);
        if (branch && !branch.startsWith("(")) {
          local.push(branch);
        }
      } else {
        local.push(trimmed);
      }
    }
  } catch {
    // ignore
  }

  try {
    const remoteOutput = execFileSync("git", ["branch", "-r", "--no-color"], {
      cwd: dir,
      timeout: 5000,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    for (const line of remoteOutput.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.includes("->")) continue;
      // Strip remote prefix for cleaner display
      const remote_name = getPrimaryRemote(dir);
      const name = trimmed.replace(new RegExp(`^${remote_name}/`), "");
      if (name && !remote.includes(name)) {
        remote.push(name);
      }
    }
  } catch {
    // ignore
  }

  return { local, remote, current };
}

/**
 * Get the number of commits ahead/behind relative to upstream tracking branch.
 * Returns { ahead: 0, behind: 0 } if no upstream is configured.
 */
export function getAheadBehind(dir: string): { ahead: number; behind: number } {
  try {
    const output = execFileSync(
      "git",
      ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
      {
        cwd: dir,
        timeout: 5000,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    const [behind, ahead] = output.trim().split(/\s+/).map(Number);
    return { ahead: ahead || 0, behind: behind || 0 };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

/**
 * Switch branch. Throws on dirty working tree or invalid branch.
 */
export function checkoutBranch(dir: string, branch: string): void {
  execFileSync("git", ["checkout", branch], {
    cwd: dir,
    timeout: 10000,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// ─── Remote Operations ────────────────────────────────────────────────────

/**
 * Fetch from remote with pruning.
 */
export async function gitFetch(dir: string): Promise<{ success: boolean; error?: string }> {
  try {
    await execFileAsync("git", ["fetch", "--prune"], {
      cwd: dir,
      timeout: 30000,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Pull with fast-forward only (safe default).
 */
export async function gitPull(dir: string): Promise<{ success: boolean; error?: string }> {
  try {
    await execFileAsync("git", ["pull", "--ff-only"], {
      cwd: dir,
      timeout: 30000,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Push to remote. Optionally set upstream tracking.
 */
export async function gitPush(
  dir: string,
  branch?: string,
  setUpstream?: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    const args = ["push"];
    const remote = getPrimaryRemote(dir);
    if (setUpstream && branch) {
      args.push("-u", remote, branch);
    } else if (branch) {
      args.push(remote, branch);
    }
    await execFileAsync("git", args, {
      cwd: dir,
      timeout: 30000,
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
