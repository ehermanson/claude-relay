/**
 * SpaceManager — Space lifecycle management for Relay
 *
 * A Space groups multiple concurrent agent chats within a shared git worktree/branch.
 * Every project has an implicit "main" space (no worktree, default branch).
 * Additional spaces create dedicated worktrees for isolation.
 */

import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { execSync, execFileSync } from "child_process";
import { join } from "path";
import { homedir } from "os";
import { EventEmitter } from "events";

import type { SessionDB } from "./db.js";
import type { SpaceRow } from "./db.js";
import type { Logger } from "./logger.js";
import type { SpaceInfo, SpaceStatus } from "./types.js";
import {
  isGitRepo,
  getRepoRoot,
  getDefaultBranch,
  getCurrentBranch,
  removeWorktree,
  isWorktreeDirty,
  commitAll,
  mergeWorktreeBranch,
  getWorktreeDiff,
  gitPush,
} from "./git.js";

function rowToInfo(row: SpaceRow, chatCount: number): SpaceInfo {
  return {
    id: row.id,
    projectDirectory: row.project_directory,
    name: row.name,
    gitBranch: row.git_branch,
    worktreePath: row.worktree_path,
    isDefault: row.is_default === 1,
    status: row.status as SpaceStatus,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    chatCount,
  };
}

export interface SpaceManagerEvents {
  "space:created": [space: SpaceInfo];
  "space:completed": [spaceId: string, projectDirectory: string, targetBranch: string];
  "space:removed": [spaceId: string, projectDirectory: string];
}

export interface SpaceManager {
  on<E extends keyof SpaceManagerEvents>(
    event: E,
    listener: (...args: SpaceManagerEvents[E]) => void,
  ): this;
  emit<E extends keyof SpaceManagerEvents>(event: E, ...args: SpaceManagerEvents[E]): boolean;
  off<E extends keyof SpaceManagerEvents>(
    event: E,
    listener: (...args: SpaceManagerEvents[E]) => void,
  ): this;
}

export class SpaceManager extends EventEmitter {
  constructor(
    private db: SessionDB,
    private logger: Logger,
  ) {
    super();
  }

  private getExistingWorktreePath(worktreePath: string | null): string | null {
    if (!worktreePath) return null;
    return existsSync(worktreePath) ? worktreePath : null;
  }

  private toInfo(row: SpaceRow): SpaceInfo {
    const worktreePath = this.getExistingWorktreePath(row.worktree_path);
    return rowToInfo(
      {
        ...row,
        worktree_path: worktreePath,
      },
      this.db.getSpaceChatCount(row.id),
    );
  }

  /**
   * Get or lazily create the implicit default space for a project.
   * The default space has no worktree — it represents the main branch.
   */
  getOrCreateDefaultSpace(projectDirectory: string): SpaceInfo {
    const existing = this.db.getDefaultSpace(projectDirectory);
    if (existing) {
      return rowToInfo(existing, this.db.getSpaceChatCount(existing.id));
    }

    const now = Date.now();
    const row: SpaceRow = {
      id: randomUUID(),
      project_directory: projectDirectory,
      name: "main",
      git_branch: null,
      worktree_path: null,
      is_default: 1,
      status: "active",
      created_at: now,
      last_activity_at: now,
    };
    this.db.upsertSpace(row);
    this.logger.info(`[SpaceManager] Created default space for ${projectDirectory}`);
    return this.toInfo(row);
  }

  /**
   * Create a new space with its own git worktree.
   * Requires the project to be a git repository.
   */
  createSpace(projectDirectory: string, opts?: { name?: string; baseBranch?: string }): SpaceInfo {
    if (!isGitRepo(projectDirectory)) {
      throw new Error("Cannot create space: project is not a git repository");
    }

    const repoRoot = getRepoRoot(projectDirectory);
    if (!repoRoot) {
      throw new Error("Cannot determine git repository root");
    }

    // Ensure default space exists
    this.getOrCreateDefaultSpace(projectDirectory);

    const id = randomUUID();
    const shortId = id.slice(0, 8);
    const branchName = `relay-space/${shortId}`;

    // Create the worktree
    const worktreeBase = join(homedir(), ".relay", "worktrees");
    const worktreePath = join(worktreeBase, `space-${shortId}`);

    try {
      const baseBranch = opts?.baseBranch || getCurrentBranch(repoRoot) || "HEAD";
      execSync(`git worktree add -b "${branchName}" "${worktreePath}" "${baseBranch}"`, {
        cwd: repoRoot,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 30000,
      });
    } catch (err) {
      throw new Error(
        `Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const spaceName = opts?.name || branchName;
    const now = Date.now();
    const row: SpaceRow = {
      id,
      project_directory: projectDirectory,
      name: spaceName,
      git_branch: branchName,
      worktree_path: worktreePath,
      is_default: 0,
      status: "active",
      created_at: now,
      last_activity_at: now,
    };
    this.db.upsertSpace(row);
    this.logger.info(
      `[SpaceManager] Created space "${spaceName}" (${id}) with worktree at ${worktreePath}`,
    );
    const info = this.toInfo(row);
    this.emit("space:created", info);
    return info;
  }

  /**
   * List all active spaces for a project.
   */
  listSpaces(projectDirectory: string): SpaceInfo[] {
    const rows = this.db.getSpacesByProject(projectDirectory);
    return rows.map((row) => this.toInfo(row));
  }

  /**
   * Get a space by ID.
   */
  getSpace(id: string): SpaceInfo | undefined {
    const row = this.db.getSpace(id);
    if (!row) return undefined;
    return this.toInfo(row);
  }

  /**
   * Complete a space: auto-commit, merge branch into default, archive, cleanup worktree.
   */
  completeSpace(id: string): { targetBranch: string; mergeCommit?: string } {
    const row = this.db.getSpace(id);
    if (!row) throw new Error(`Space ${id} not found`);
    if (row.is_default) throw new Error("Cannot complete the default space");
    if (!row.git_branch || !row.worktree_path) {
      throw new Error("Space has no worktree to complete");
    }

    const repoRoot = getRepoRoot(row.project_directory);
    if (!repoRoot) throw new Error("Cannot determine git repository root");

    // Pre-check: refuse to merge if the main worktree has uncommitted changes
    if (isWorktreeDirty(repoRoot)) {
      throw new Error(
        "Your main branch has uncommitted changes. Please commit or stash them before merging a space.",
      );
    }

    // Auto-commit if dirty
    if (existsSync(row.worktree_path) && isWorktreeDirty(row.worktree_path)) {
      const commitResult = commitAll(row.worktree_path, row.name || "Space work");
      if (!commitResult.success) {
        throw new Error(`Auto-commit failed: ${commitResult.error}`);
      }
    }

    const defaultBranch = getDefaultBranch(repoRoot) || getCurrentBranch(repoRoot) || "main";

    const mergeResult = mergeWorktreeBranch(repoRoot, row.git_branch);
    if (!mergeResult.success) {
      if (mergeResult.error === "CONFLICT") {
        throw new Error(
          `Merge conflicts — the space and main branch have overlapping changes.\n\nTo resolve, run:\n  cd ${row.worktree_path}\n  git rebase ${defaultBranch}\n\nFix any conflicts, then try completing the space again.`,
        );
      }
      throw new Error(`Merge failed: ${mergeResult.error}`);
    }

    // Capture the merge commit hash
    let mergeCommit: string | undefined;
    try {
      mergeCommit = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
    } catch {
      // non-critical
    }

    this.logger.info(
      `[SpaceManager] Merged space "${row.name}" (${row.git_branch}) into ${defaultBranch}`,
    );

    // Cleanup worktree
    if (existsSync(row.worktree_path)) {
      removeWorktree(repoRoot, row.worktree_path, row.git_branch);
    }

    // Mark as completed
    this.db.updateSpaceStatus(id, "completed");
    this.emit("space:completed", id, row.project_directory, defaultBranch);

    return { targetBranch: defaultBranch, mergeCommit };
  }

  /**
   * Delete/archive a space without merging. Cleans up the worktree.
   */
  deleteSpace(id: string): void {
    const row = this.db.getSpace(id);
    if (!row) throw new Error(`Space ${id} not found`);
    if (row.is_default) throw new Error("Cannot delete the default space");

    // Cleanup worktree if it exists
    if (row.git_branch && row.worktree_path) {
      const repoRoot = getRepoRoot(row.project_directory);
      if (repoRoot && existsSync(row.worktree_path)) {
        removeWorktree(repoRoot, row.worktree_path, row.git_branch);
      }
    }

    this.db.updateSpaceStatus(id, "archived");
    this.logger.info(`[SpaceManager] Archived space "${row.name}" (${id})`);
    this.emit("space:removed", id, row.project_directory);
  }

  /**
   * Get the unified diff for a space's branch vs the repo default branch.
   */
  getSpaceDiff(id: string): string | null {
    const row = this.db.getSpace(id);
    if (!row || !row.git_branch) return null;

    const worktreePath = this.getExistingWorktreePath(row.worktree_path);
    if (!worktreePath) {
      return "";
    }

    const repoRoot = getRepoRoot(row.project_directory);
    if (!repoRoot) return null;

    const defaultBranch = getDefaultBranch(repoRoot) || getCurrentBranch(repoRoot) || "main";

    // Diff from inside the worktree so we capture both committed and
    // uncommitted changes vs the base branch.
    return getWorktreeDiff(worktreePath, defaultBranch);
  }

  /**
   * Push a space's branch to the remote. Optionally create a PR via gh CLI.
   */
  async pushSpace(
    id: string,
    opts?: { createPR?: boolean },
  ): Promise<{ pushed: boolean; prUrl?: string; error?: string }> {
    const row = this.db.getSpace(id);
    if (!row) throw new Error(`Space ${id} not found`);
    if (row.is_default) throw new Error("Cannot push the default space");
    if (!row.git_branch || !row.worktree_path) {
      throw new Error("Space has no worktree to push");
    }

    // Auto-commit if dirty
    if (existsSync(row.worktree_path) && isWorktreeDirty(row.worktree_path)) {
      const commitResult = commitAll(row.worktree_path, row.name || "Space work");
      if (!commitResult.success) {
        throw new Error(`Auto-commit failed: ${commitResult.error}`);
      }
    }

    // Push with upstream tracking
    const pushResult = await gitPush(row.worktree_path, row.git_branch, true);
    if (!pushResult.success) {
      return { pushed: false, error: pushResult.error || "Push failed" };
    }

    this.logger.info(`[SpaceManager] Pushed space "${row.name}" branch ${row.git_branch}`);

    // Optionally create PR via gh CLI
    if (opts?.createPR) {
      try {
        // Check if gh is available
        execFileSync("which", ["gh"], { stdio: "pipe", timeout: 3000 });

        const repoRoot = getRepoRoot(row.project_directory);
        const defaultBranch = (repoRoot ? getDefaultBranch(repoRoot) : null) || "main";
        const title = row.name || `Space ${row.id.slice(0, 8)}`;

        const prOutput = execFileSync(
          "gh",
          [
            "pr",
            "create",
            "--head",
            row.git_branch,
            "--base",
            defaultBranch,
            "--title",
            title,
            "--fill",
          ],
          {
            cwd: row.worktree_path,
            encoding: "utf8",
            timeout: 30000,
            stdio: ["pipe", "pipe", "pipe"],
          },
        ).trim();

        // gh pr create outputs the PR URL on success
        const prUrl = prOutput.match(/https?:\/\/\S+/)?.[0];
        return { pushed: true, prUrl };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("which gh") || msg.includes("not found")) {
          return { pushed: true, error: "gh CLI not found — branch pushed but PR not created" };
        }
        return { pushed: true, error: `PR creation failed: ${msg}` };
      }
    }

    return { pushed: true };
  }

  /**
   * Update space last activity timestamp.
   */
  touchSpace(id: string): void {
    this.db.updateSpaceActivity(id, Date.now());
  }
}
