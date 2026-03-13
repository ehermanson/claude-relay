/**
 * Git utility functions for worktree isolation.
 *
 * All functions use execSync following the existing pattern used for
 * `which claude`, `ps`, and `lsof` elsewhere in the codebase.
 */

import { execSync, execFileSync, execFile as execFileCb } from "child_process";
import { existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import { promisify } from "util";

import type { FileChange } from "./types.js";

const WORKTREE_BASE = join(homedir(), ".relay", "worktrees");

/** Pattern matching ~/.relay/worktrees/<id> paths */
const RELAY_WORKTREE_RE = /[/\\]\.relay[/\\]worktrees[/\\][a-f0-9]+\/?$/;

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
    return execSync("git rev-parse --abbrev-ref HEAD", {
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
    const errorMessage = err instanceof Error ? err.message : "Unknown merge error";
    try {
      execSync("git merge --abort", {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10000,
      });
    } catch {
      // abort may fail if merge didn't start — ignore
    }
    return { success: false, error: errorMessage };
  }
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
    execSync(`git add -A && git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: worktreePath,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
    });
    return { success: true };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown commit error";
    return { success: false, error: errorMessage };
  }
}

/**
 * Remove a git worktree and its branch.
 *
 * Safe to call when the worktree or branch has already been removed.
 */
export function removeWorktree(repoRoot: string, worktreePath: string, branchName: string): void {
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

  // Delete the branch
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

/**
 * Find the commit hash that was HEAD at or before the given timestamp.
 * Used to establish a diff baseline for a session's lifetime.
 */
function getBaseCommit(cwd: string, beforeTimestamp: number): string | null {
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
    let baseRef = "HEAD";
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

    if (!output) return;

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
    return stdout.trim();
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
    const branch = branchResult.stdout.trim();
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

async function getBaseCommitAsync(cwd: string, beforeTimestamp: number): Promise<string | null> {
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

export async function enrichDiffStatsAsync(
  cwd: string,
  files: Map<string, FileChange>,
  opts?: { originalBranch?: string; sessionCreatedAt?: number },
): Promise<void> {
  try {
    const repoRoot = await getRepoRootAsync(cwd);
    if (!repoRoot) return;

    let baseRef = "HEAD";
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
    if (!output) return;

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
  } catch {
    // git not available or not a repo — silently skip
  }
}
