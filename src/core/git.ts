/**
 * Git utility functions for worktree isolation.
 *
 * All functions use execSync following the existing pattern used for
 * `which claude`, `ps`, and `lsof` elsewhere in the codebase.
 */

import { execSync } from "child_process";
import { join } from "path";
import { homedir } from "os";

const WORKTREE_BASE = join(homedir(), ".claude-relay", "worktrees");

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
 * in `~/.claude-relay/worktrees/<shortId>/`.
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
