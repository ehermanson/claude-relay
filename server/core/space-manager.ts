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
import { basename, join } from "path";
import { EventEmitter } from "events";

import type { SessionDB } from "#core/db.js";
import type { SpaceRow } from "#core/db.js";
import type { Logger } from "#core/logger.js";
import type { SpaceInfo, SpaceStatus, MergeMethod } from "#core/types.js";
import {
  isGitRepo,
  getRepoRoot,
  getDefaultBranch,
  getCurrentBranch,
  removeWorktree,
  isWorktreeDirty,
  commitAll,
  mergeWorktreeBranch,
  squashMergeBranch,
  getWorktreeDiff,
  gitPush,
  getWorktreeBase,
} from "#core/git.js";

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
    mergeCommit: row.merge_commit,
    mergeMethod: row.merge_method as MergeMethod | null,
    mergedAt: row.merged_at,
    targetBranch: row.target_branch,
    remoteStatus: row.remote_status,
    prUrl: row.pr_url,
  };
}

export interface SpaceManagerEvents {
  "space:created": [space: SpaceInfo];
  "space:updated": [space: SpaceInfo];
  "space:completed": [
    spaceId: string,
    projectDirectory: string,
    targetBranch: string,
    mergeMethod: string,
    mergeCommit?: string,
  ];
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
  private db: SessionDB;
  private logger: Logger;

  constructor(db: SessionDB, logger: Logger) {
    super();
    this.db = db;
    this.logger = logger;
  }

  private getExistingWorktreePath(worktreePath: string | null): string | null {
    if (!worktreePath) return null;
    return existsSync(worktreePath) && isGitRepo(worktreePath) ? worktreePath : null;
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

  private deriveRecoveredSpaceId(row: {
    space_id: string | null;
    worktree_path: string | null;
    git_branch: string | null;
  }): string | null {
    if (row.space_id) return row.space_id;

    const worktreeBase = row.worktree_path ? basename(row.worktree_path) : null;
    if (worktreeBase?.startsWith("space-")) {
      return `recovered-${worktreeBase}`;
    }

    const branchSuffix = row.git_branch?.match(/^relay-space\/(.+)$/)?.[1];
    if (branchSuffix) {
      return `recovered-space-${branchSuffix}`;
    }

    return null;
  }

  private deriveRecoveredSpaceName(row: {
    git_branch: string | null;
    worktree_path: string | null;
  }): string {
    return row.git_branch ?? row.worktree_path ?? "Recovered space";
  }

  private findMatchingSpaceRow(
    existingSpaces: Iterable<SpaceRow>,
    row: { project_directory: string; git_branch: string | null; worktree_path: string | null },
  ): SpaceRow | null {
    for (const existing of existingSpaces) {
      if (existing.project_directory !== row.project_directory) continue;
      if (row.git_branch && existing.git_branch === row.git_branch) return existing;
      if (row.worktree_path && existing.worktree_path === row.worktree_path) return existing;
    }
    return null;
  }

  private inferRecoveredSpaceStatus(row: {
    project_directory: string;
    git_branch: string | null;
    worktree_path: string | null;
    git_info_branch: string | null;
    last_activity_at: number;
  }): Pick<SpaceRow, "status" | "worktree_path" | "merged_at" | "target_branch"> {
    const worktreePath = this.getExistingWorktreePath(row.worktree_path);
    if (worktreePath) {
      return {
        status: "active",
        worktree_path: worktreePath,
        merged_at: null,
        target_branch: null,
      };
    }

    if (row.git_info_branch && row.git_branch && row.git_info_branch !== row.git_branch) {
      return {
        status: "completed",
        worktree_path: null,
        merged_at: row.last_activity_at,
        target_branch: row.git_info_branch,
      };
    }

    const repoRoot = getRepoRoot(row.project_directory);
    if (!repoRoot || !row.git_branch) {
      return {
        status: "active",
        worktree_path: null,
        merged_at: null,
        target_branch: null,
      };
    }

    const targetBranch = getDefaultBranch(repoRoot) || getCurrentBranch(repoRoot);
    if (!targetBranch || targetBranch === row.git_branch) {
      return {
        status: "active",
        worktree_path: null,
        merged_at: null,
        target_branch: null,
      };
    }

    try {
      execFileSync("git", ["merge-base", "--is-ancestor", row.git_branch, targetBranch], {
        cwd: repoRoot,
        stdio: "pipe",
        timeout: 5000,
      });
      return {
        status: "completed",
        worktree_path: null,
        merged_at: row.last_activity_at,
        target_branch: targetBranch,
      };
    } catch {
      return {
        status: "active",
        worktree_path: null,
        merged_at: null,
        target_branch: null,
      };
    }
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
      merge_commit: null,
      merge_method: null,
      merged_at: null,
      target_branch: null,
      remote_status: null,
      pr_url: null,
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
    const worktreeBase = getWorktreeBase();
    const worktreePath = join(worktreeBase, `space-${shortId}`);

    try {
      const baseBranch =
        opts?.baseBranch || getDefaultBranch(repoRoot) || getCurrentBranch(repoRoot) || "HEAD";
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
      merge_commit: null,
      merge_method: null,
      merged_at: null,
      target_branch: null,
      remote_status: null,
      pr_url: null,
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
    if (isGitRepo(projectDirectory)) {
      this.getOrCreateDefaultSpace(projectDirectory);
    }
    const rows = this.db.getSpacesByProject(projectDirectory);
    return rows.map((row) => this.toInfo(row));
  }

  /**
   * List all non-default spaces including closed (completed/archived).
   */
  listAllSpaces(projectDirectory: string): SpaceInfo[] {
    if (isGitRepo(projectDirectory)) {
      this.getOrCreateDefaultSpace(projectDirectory);
    }
    const rows = this.db.getSpacesByProjectAll(projectDirectory);
    return rows.map((row) => this.toInfo(row));
  }

  recoverSpacesFromSessionMetadata(): number {
    const existingSpaces = new Map<string, SpaceRow>();
    const defaultSpaces = new Set<string>();

    for (const project of this.db.getAllProjects()) {
      for (const space of this.db.getSpacesByProject(project.directory)) {
        existingSpaces.set(space.id, space);
        if (space.is_default === 1) {
          defaultSpaces.add(project.directory);
        }
      }
    }

    const activeProjects = new Set<string>();
    for (const row of this.db.getAllActive()) {
      activeProjects.add(row.original_directory ?? row.working_directory);
    }
    for (const row of this.db.getAllManagedActive()) {
      activeProjects.add(row.original_directory ?? row.working_directory);
    }

    let recovered = 0;
    for (const projectDirectory of activeProjects) {
      if (!defaultSpaces.has(projectDirectory) && isGitRepo(projectDirectory)) {
        this.getOrCreateDefaultSpace(projectDirectory);
        defaultSpaces.add(projectDirectory);
        recovered++;
      }
    }

    const recoveredSpaces = new Map<
      string,
      {
        row: SpaceRow & { git_info_branch: string | null };
        sessionIds: string[];
        managedInstanceIds: string[];
      }
    >();

    const collect = (
      row: {
        session_id?: string;
        instance_id?: string;
        working_directory: string;
        original_directory: string | null;
        worktree_path: string | null;
        git_branch: string | null;
        git_info_branch: string | null;
        original_git_branch?: string | null;
        space_id: string | null;
        created_at: number;
        last_activity_at: number;
        archived: number;
      },
      kind: "session" | "managed",
    ) => {
      if (row.archived) return;
      const spaceBranch = row.git_branch ?? row.original_git_branch ?? null;
      if (!row.worktree_path && !spaceBranch?.startsWith("relay-space/")) return;

      const projectDirectory = row.original_directory ?? row.working_directory;
      const id = this.deriveRecoveredSpaceId({
        ...row,
        git_branch: spaceBranch,
      });
      if (!id) return;

      const existing = recoveredSpaces.get(id);
      if (!existing) {
        recoveredSpaces.set(id, {
          row: {
            id,
            project_directory: projectDirectory,
            name: this.deriveRecoveredSpaceName({
              ...row,
              git_branch: spaceBranch,
            }),
            git_branch: spaceBranch,
            worktree_path: row.worktree_path,
            is_default: 0,
            status: "active",
            created_at: row.created_at,
            last_activity_at: row.last_activity_at,
            merge_commit: null,
            merge_method: null,
            merged_at: null,
            target_branch: null,
            remote_status: null,
            pr_url: null,
            git_info_branch: row.git_info_branch,
          },
          sessionIds: kind === "session" && row.session_id ? [row.session_id] : [],
          managedInstanceIds: kind === "managed" && row.instance_id ? [row.instance_id] : [],
        });
        return;
      }

      existing.row.created_at = Math.min(existing.row.created_at, row.created_at);
      existing.row.last_activity_at = Math.max(existing.row.last_activity_at, row.last_activity_at);
      existing.row.project_directory = projectDirectory;
      existing.row.git_branch = existing.row.git_branch ?? spaceBranch;
      existing.row.worktree_path = existing.row.worktree_path ?? row.worktree_path;
      existing.row.git_info_branch = existing.row.git_info_branch ?? row.git_info_branch;

      if (kind === "session" && row.session_id) {
        existing.sessionIds.push(row.session_id);
      }
      if (kind === "managed" && row.instance_id) {
        existing.managedInstanceIds.push(row.instance_id);
      }
    };

    for (const row of this.db.getAllActive()) {
      collect(row, "session");
    }
    for (const row of this.db.getAllManagedActive()) {
      collect(row, "managed");
    }

    for (const { row, sessionIds, managedInstanceIds } of recoveredSpaces.values()) {
      const matching = this.findMatchingSpaceRow(existingSpaces.values(), row);
      const linkedSpaceId = matching?.id ?? row.id;
      const recoveredMeta = this.inferRecoveredSpaceStatus(row);
      const upsertRow: SpaceRow = matching
        ? {
            ...matching,
            git_branch: matching.git_branch ?? row.git_branch,
            worktree_path: recoveredMeta.worktree_path,
            status: recoveredMeta.status,
            last_activity_at: Math.max(matching.last_activity_at, row.last_activity_at),
            merged_at: matching.merged_at ?? recoveredMeta.merged_at,
            target_branch: matching.target_branch ?? recoveredMeta.target_branch,
          }
        : {
            ...row,
            ...recoveredMeta,
          };

      this.db.upsertSpace(upsertRow);
      if (!matching) {
        existingSpaces.set(upsertRow.id, upsertRow);
        recovered++;
      }

      for (const sessionId of sessionIds) {
        this.db.updateSessionSpaceId(sessionId, linkedSpaceId);
      }
      for (const instanceId of managedInstanceIds) {
        this.db.updateManagedSpaceId(instanceId, linkedSpaceId);
      }
    }

    if (recovered > 0) {
      this.logger.info(`[SpaceManager] Recovered ${recovered} space row(s) from session metadata`);
    }

    return recovered;
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
   * Get the working directory for a space (worktree path if available, else project dir).
   * Returns undefined if the space is not found.
   */
  getSpaceWorkingDirectory(spaceId?: string): string | undefined {
    if (!spaceId) return undefined;
    const space = this.getSpace(spaceId);
    if (!space) return undefined;
    return space.worktreePath ?? space.projectDirectory;
  }

  renameSpace(id: string, name: string): SpaceInfo {
    const row = this.db.getSpace(id);
    if (!row) {
      throw new Error(`Space ${id} not found`);
    }
    if (row.is_default) {
      throw new Error("Cannot rename the default space");
    }

    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error("Space name cannot be empty");
    }

    const now = Date.now();
    this.db.updateSpaceName(id, trimmed, now);
    const updated = this.db.getSpace(id);
    if (!updated) {
      throw new Error(`Space ${id} not found after rename`);
    }
    const info = this.toInfo(updated);
    this.emit("space:updated", info);
    return info;
  }

  /**
   * Complete a space: auto-commit, merge branch into default, archive, cleanup worktree.
   */
  completeSpace(
    id: string,
    opts?: { mergeMethod?: MergeMethod; squashMessage?: string },
  ): { targetBranch: string; mergeCommit?: string; mergeMethod: MergeMethod } {
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
        "Your main workspace has uncommitted changes. Commit or stash them before completing this space.",
      );
    }

    // Auto-commit if dirty
    if (existsSync(row.worktree_path) && isWorktreeDirty(row.worktree_path)) {
      const commitResult = commitAll(row.worktree_path, row.name || "Space work");
      if (!commitResult.success) {
        throw new Error(`Auto-commit failed: ${commitResult.error}`);
      }
    }

    const mergeMethod: MergeMethod = opts?.mergeMethod || "squash";
    if (mergeMethod !== "squash" && mergeMethod !== "merge-commit") {
      throw new Error(`Unsupported merge method: ${mergeMethod}`);
    }

    // Record the actual branch that will receive the merge — this is the
    // branch currently checked out in the main worktree, not the heuristic
    // "default branch". The merge helpers operate on the checked-out branch,
    // so this must match what we persist and display.
    const currentBranch = getCurrentBranch(repoRoot);
    const targetBranch = currentBranch || getDefaultBranch(repoRoot) || "main";

    // Execute the merge using the selected strategy
    let mergeResult: { success: true } | { success: false; error: string };

    switch (mergeMethod) {
      case "squash": {
        const message = opts?.squashMessage || `Space: ${row.name}`;
        mergeResult = squashMergeBranch(repoRoot, row.git_branch, message);
        break;
      }
      case "merge-commit":
        mergeResult = mergeWorktreeBranch(repoRoot, row.git_branch);
        break;
    }

    if (!mergeResult.success) {
      if (mergeResult.error === "CONFLICT") {
        const methodHint =
          mergeMethod === "squash"
            ? `Squash merge has conflicts — the space and main workspace have overlapping changes.\n\nTo resolve, run:\n  cd ${row.worktree_path}\n  git rebase ${targetBranch}\n\nFix any conflicts, then try completing the space again.`
            : `Merge conflicts — the space and main workspace have overlapping changes.\n\nTo resolve, run:\n  cd ${row.worktree_path}\n  git rebase ${targetBranch}\n\nFix any conflicts, then try completing the space again.`;
        throw new Error(methodHint);
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
      `[SpaceManager] Merged space "${row.name}" (${row.git_branch}) into ${targetBranch} via ${mergeMethod}`,
    );

    // Cleanup worktree (keep local branch for recoverability)
    if (existsSync(row.worktree_path)) {
      removeWorktree(repoRoot, row.worktree_path, row.git_branch, { keepBranch: true });
    }

    // Store merge metadata
    this.db.updateSpaceMergeMetadata(id, mergeCommit, mergeMethod, Date.now(), targetBranch);
    this.emit("space:completed", id, row.project_directory, targetBranch, mergeMethod, mergeCommit);

    return { targetBranch, mergeCommit, mergeMethod };
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
  ): Promise<{
    pushed: boolean;
    prUrl?: string;
    error?: string;
    ghNotFound?: boolean;
    ghNotAuthenticated?: boolean;
  }> {
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

    // Persist remote status
    this.db.updateSpaceRemoteStatus(id, "pushed");
    this.emit("space:updated", this.toInfo(this.db.getSpace(id)!));

    // Optionally create PR via gh CLI
    if (opts?.createPR) {
      // Check if gh is available
      try {
        execFileSync("which", ["gh"], { stdio: "pipe", timeout: 3000 });
      } catch {
        return {
          pushed: true,
          error: "gh CLI not found — branch pushed but PR not created",
          ghNotFound: true,
        };
      }

      try {
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
        this.db.updateSpaceRemoteStatus(id, "pr-open", prUrl);
        this.emit("space:updated", this.toInfo(this.db.getSpace(id)!));
        return { pushed: true, prUrl };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("gh auth login") || msg.includes("GH_TOKEN")) {
          return { pushed: true, error: "gh CLI is not authenticated", ghNotAuthenticated: true };
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
