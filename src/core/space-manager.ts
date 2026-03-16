/**
 * SpaceManager — Space lifecycle management for Relay
 *
 * A Space groups multiple concurrent agent chats within a shared git worktree/branch.
 * Every project has an implicit "main" space (no worktree, default branch).
 * Additional spaces create dedicated worktrees for isolation.
 */

import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { homedir } from "os";

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

export class SpaceManager {
  constructor(
    private db: SessionDB,
    private logger: Logger,
  ) {}

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
    return rowToInfo(row, 0);
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
    const branchName = `space/${shortId}`;

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
    return rowToInfo(row, 0);
  }

  /**
   * List all active spaces for a project.
   */
  listSpaces(projectDirectory: string): SpaceInfo[] {
    const rows = this.db.getSpacesByProject(projectDirectory);
    return rows.map((row) => rowToInfo(row, this.db.getSpaceChatCount(row.id)));
  }

  /**
   * Get a space by ID.
   */
  getSpace(id: string): SpaceInfo | undefined {
    const row = this.db.getSpace(id);
    if (!row) return undefined;
    return rowToInfo(row, this.db.getSpaceChatCount(row.id));
  }

  /**
   * Complete a space: auto-commit, merge branch into default, archive, cleanup worktree.
   */
  completeSpace(id: string): { targetBranch: string } {
    const row = this.db.getSpace(id);
    if (!row) throw new Error(`Space ${id} not found`);
    if (row.is_default) throw new Error("Cannot complete the default space");
    if (!row.git_branch || !row.worktree_path) {
      throw new Error("Space has no worktree to complete");
    }

    const repoRoot = getRepoRoot(row.project_directory);
    if (!repoRoot) throw new Error("Cannot determine git repository root");

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
      throw new Error(`Merge failed: ${mergeResult.error}`);
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

    return { targetBranch: defaultBranch };
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
  }

  /**
   * Get the unified diff for a space's branch vs the repo default branch.
   */
  getSpaceDiff(id: string): string | null {
    const row = this.db.getSpace(id);
    if (!row || !row.git_branch || !row.worktree_path) return null;

    const repoRoot = getRepoRoot(row.project_directory);
    if (!repoRoot) return null;

    const defaultBranch = getDefaultBranch(repoRoot) || getCurrentBranch(repoRoot) || "main";

    // Diff from inside the worktree so we capture both committed and
    // uncommitted changes vs the base branch.
    return getWorktreeDiff(row.worktree_path, defaultBranch);
  }

  /**
   * Update space last activity timestamp.
   */
  touchSpace(id: string): void {
    this.db.updateSpaceActivity(id, Date.now());
  }
}
