/**
 * ProjectManager — manages explicit project registration for Relay.
 *
 * Projects are the organizing primitive: sessions are scoped to projects,
 * external discovery only watches registered project directories.
 * All projects must be git repositories.
 */

import { randomUUID } from "crypto";
import { existsSync, mkdirSync, realpathSync } from "fs";
import { basename, join } from "path";
import { EventEmitter } from "events";

import { SessionDB } from "#core/db.js";
import type { ProjectRow } from "#core/db.js";
import type { Project } from "#core/types.js";
import type { Logger } from "#core/logger.js";
import {
  gitInit,
  isGitRepo,
  getRepoRoot,
  getRemoteUrl,
  getCurrentBranch,
  isRelayWorktreePath,
  resolveWorktreeOrigin,
} from "#core/git.js";

export interface ProjectManagerEvents {
  "project:created": [project: Project];
  "project:updated": [project: Project];
  "project:removed": [projectId: string];
}

export interface ProjectManager {
  on<E extends keyof ProjectManagerEvents>(
    event: E,
    listener: (...args: ProjectManagerEvents[E]) => void,
  ): this;
  emit<E extends keyof ProjectManagerEvents>(event: E, ...args: ProjectManagerEvents[E]): boolean;
  off<E extends keyof ProjectManagerEvents>(
    event: E,
    listener: (...args: ProjectManagerEvents[E]) => void,
  ): this;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    directory: row.directory,
    repoRoot: row.repo_root,
    remoteUrl: row.remote_url,
    targetBranch: row.target_branch,
    customInstructions: row.custom_instructions,
    defaultSpaceBranch: row.default_space_branch,
    spaceBranchSource: (row.space_branch_source as "local" | "remote") ?? null,
    defaultProvider: row.default_provider,
    defaultModel: row.default_model,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
  };
}

export class ProjectManager extends EventEmitter {
  private db: SessionDB;
  private logger: Logger;

  constructor(db: SessionDB, logger: Logger) {
    super();
    this.db = db;
    this.logger = logger;
    this.archiveOrphanedWorktreeSessions();
    this.normalizeRegisteredProjects();
  }

  /**
   * Archive sessions that reference relay worktree paths with no corresponding space.
   * These are orphaned worktree sessions that should not trigger project recovery.
   */
  private archiveOrphanedWorktreeSessions(): void {
    let archived = 0;
    for (const worktreePath of this.db.getDistinctWorktreePaths()) {
      if (!isRelayWorktreePath(worktreePath)) continue;
      if (this.db.getSpaceByWorktreePath(worktreePath)) continue;

      this.db.archiveSessionsByWorktreePath(worktreePath);
      archived++;
      this.logger.info(
        `[ProjectManager] Archived orphaned worktree sessions for ${worktreePath} (no corresponding space)`,
      );
    }
    if (archived > 0) {
      this.logger.info(
        `[ProjectManager] Archived sessions from ${archived} orphaned worktree path(s)`,
      );
    }
  }

  private normalizeRegisteredProjects(): void {
    for (const project of this.db.getAllProjects()) {
      if (!isRelayWorktreePath(project.directory)) {
        continue;
      }

      // If this relay worktree has no corresponding space, it's orphaned.
      // Remove the project registration — it should never have been created.
      if (!this.db.getSpaceByWorktreePath(project.directory)) {
        this.db.assignSessionsToProject(null, project.directory);
        this.db.deleteProject(project.id);
        this.logger.info(
          `[ProjectManager] Removed orphaned relay worktree project ${project.directory} (no corresponding space)`,
        );
        continue;
      }

      const origin = resolveWorktreeOrigin(project.directory);
      if (!origin || origin === project.directory) {
        continue;
      }

      const canonicalDirectory = getRepoRoot(origin) ?? origin;
      const existing = this.db.getProjectByDirectory(canonicalDirectory);

      if (existing && existing.id !== project.id) {
        this.db.assignSessionsToProject(existing.id, project.directory);
        this.db.reassignSpacesToProjectDirectory(canonicalDirectory, project.directory);
        this.db.deleteProject(project.id);
        this.logger.info(
          `[ProjectManager] Folded relay worktree project ${project.directory} into ${canonicalDirectory}`,
        );
        continue;
      }

      const normalized: ProjectRow = {
        ...project,
        name:
          project.name === basename(project.directory)
            ? basename(canonicalDirectory)
            : project.name,
        directory: canonicalDirectory,
        repo_root: canonicalDirectory,
        remote_url: getRemoteUrl(canonicalDirectory),
        target_branch: project.target_branch ?? getCurrentBranch(canonicalDirectory),
      };

      this.db.upsertProject(normalized);
      this.db.assignSessionsToProject(normalized.id, project.directory);
      this.db.reassignSpacesToProjectDirectory(canonicalDirectory, project.directory);
      this.logger.info(
        `[ProjectManager] Normalized relay worktree project ${project.directory} to ${canonicalDirectory}`,
      );
    }
  }

  /**
   * Rebuild missing project registrations from session rows already in SQLite.
   * This recovers the sidebar/project model after the projects table is lost
   * but session metadata is still present.
   */
  recoverProjectsFromSessionDirectories(): number {
    const existingByDirectory = new Map(
      this.db.getAllProjects().map((project) => [project.directory, project] as const),
    );
    let recovered = 0;

    for (const sessionDirectory of this.db.getDistinctSessionDirectories()) {
      const repoRoot = getRepoRoot(sessionDirectory);
      if (!repoRoot) {
        continue;
      }

      const canonicalDirectory = isRelayWorktreePath(repoRoot)
        ? (resolveWorktreeOrigin(repoRoot) ?? repoRoot)
        : repoRoot;

      let project = existingByDirectory.get(canonicalDirectory);
      if (!project) {
        const now = Date.now();
        project = {
          id: randomUUID(),
          name: basename(canonicalDirectory),
          directory: canonicalDirectory,
          repo_root: canonicalDirectory,
          remote_url: getRemoteUrl(canonicalDirectory),
          target_branch: getCurrentBranch(canonicalDirectory),
          custom_instructions: null,
          default_space_branch: null,
          space_branch_source: null,
          default_provider: null,
          default_model: null,
          created_at: now,
          last_activity_at: null,
        };
        this.db.upsertProject(project);
        existingByDirectory.set(canonicalDirectory, project);
        recovered++;
        this.emit("project:created", rowToProject(project));
      }

      this.db.assignSessionsToProject(project.id, sessionDirectory);
      if (sessionDirectory !== canonicalDirectory) {
        this.db.assignSessionsToProject(project.id, canonicalDirectory);
      }
    }

    if (recovered > 0) {
      this.logger.info(
        `[ProjectManager] Recovered ${recovered} project registration(s) from session history`,
      );
    }

    return recovered;
  }

  /**
   * Register a new project. Directory must be a git repository.
   * Returns the created project, or the existing one if already registered.
   */
  addProject(directory: string, opts?: { name?: string; targetBranch?: string }): Project {
    if (!existsSync(directory)) {
      throw new Error(`Directory does not exist: ${directory}`);
    }

    if (!isGitRepo(directory)) {
      throw new Error(`Not a git repository: ${directory}`);
    }

    const repoRoot = getRepoRoot(directory);
    if (!repoRoot) {
      throw new Error(`Could not resolve git repository root: ${directory}`);
    }
    const canonicalDirectory = isRelayWorktreePath(repoRoot)
      ? (resolveWorktreeOrigin(repoRoot) ?? repoRoot)
      : repoRoot;

    // Check for existing registration
    const existing = this.db.getProjectByDirectory(canonicalDirectory);
    if (existing) {
      return rowToProject(existing);
    }

    const remoteUrl = getRemoteUrl(canonicalDirectory);
    const targetBranch = opts?.targetBranch ?? getCurrentBranch(canonicalDirectory);

    const now = Date.now();
    const row: ProjectRow = {
      id: randomUUID(),
      name: opts?.name || basename(canonicalDirectory),
      directory: canonicalDirectory,
      repo_root: canonicalDirectory,
      remote_url: remoteUrl,
      target_branch: targetBranch,
      custom_instructions: null,
      default_space_branch: null,
      space_branch_source: null,
      default_provider: null,
      default_model: null,
      created_at: now,
      last_activity_at: null,
    };

    this.db.upsertProject(row);

    // Backfill project_id on any existing sessions for this directory
    this.db.assignSessionsToProject(row.id, canonicalDirectory);

    const project = rowToProject(row);
    this.logger.info(
      `[ProjectManager] Registered project: ${project.name} (${canonicalDirectory})`,
    );
    this.emit("project:created", project);
    return project;
  }

  /**
   * Create a new project directory, initialize a git repo, and register it.
   */
  initProject(parentDirectory: string, name: string): Project {
    if (!existsSync(parentDirectory)) {
      throw new Error(`Parent directory does not exist: ${parentDirectory}`);
    }

    // Sanitize name
    if (!name || /[/\\]/.test(name) || name === "." || name === "..") {
      throw new Error(`Invalid project name: ${name}`);
    }

    const targetDir = join(parentDirectory, name);
    if (existsSync(targetDir)) {
      throw new Error(`Directory already exists: ${targetDir}`);
    }

    mkdirSync(targetDir, { recursive: true });
    gitInit(targetDir);

    return this.addProject(targetDir, { name });
  }

  /** Remove a project and dissociate its sessions. */
  removeProject(id: string): boolean {
    const existing = this.db.getProject(id);
    if (!existing) return false;

    this.db.assignSessionsToProject(null, existing.directory);

    this.db.deleteProject(id);
    this.logger.info(`[ProjectManager] Removed project: ${existing.name}`);
    this.emit("project:removed", id);
    return true;
  }

  /** List all registered projects. */
  listProjects(): Project[] {
    return this.db.getAllProjects().map(rowToProject);
  }

  /** Get a project by ID. */
  getProject(id: string): Project | undefined {
    const row = this.db.getProject(id);
    return row ? rowToProject(row) : undefined;
  }

  /** Get a project by its directory path. */
  getProjectByDirectory(directory: string): Project | undefined {
    const row = this.db.getProjectByDirectory(directory);
    if (row) return rowToProject(row);

    let resolvedDirectory: string;
    try {
      resolvedDirectory = realpathSync(directory);
    } catch {
      return undefined;
    }

    for (const candidate of this.db.getAllProjects()) {
      try {
        if (realpathSync(candidate.directory) === resolvedDirectory) {
          return rowToProject(candidate);
        }
      } catch {
        // Ignore stale or unreadable project directories while comparing.
      }
    }

    return undefined;
  }

  /** Update project settings. */
  updateProject(
    id: string,
    updates: {
      name?: string;
      targetBranch?: string | null;
      customInstructions?: string | null;
      defaultSpaceBranch?: string | null;
      spaceBranchSource?: "local" | "remote" | null;
      defaultProvider?: string | null;
      defaultModel?: string | null;
    },
  ): Project | undefined {
    const existing = this.db.getProject(id);
    if (!existing) return undefined;

    const row: ProjectRow = {
      ...existing,
      name: updates.name ?? existing.name,
      target_branch:
        updates.targetBranch !== undefined ? updates.targetBranch : existing.target_branch,
      custom_instructions:
        updates.customInstructions !== undefined
          ? updates.customInstructions
          : existing.custom_instructions,
      default_space_branch:
        updates.defaultSpaceBranch !== undefined
          ? updates.defaultSpaceBranch
          : existing.default_space_branch,
      space_branch_source:
        updates.spaceBranchSource !== undefined
          ? updates.spaceBranchSource
          : existing.space_branch_source,
      default_provider:
        updates.defaultProvider !== undefined ? updates.defaultProvider : existing.default_provider,
      default_model:
        updates.defaultModel !== undefined ? updates.defaultModel : existing.default_model,
    };

    this.db.upsertProject(row);
    const project = rowToProject(row);
    this.emit("project:updated", project);
    return project;
  }

  /** Refresh cached git metadata for a project. */
  refreshGitInfo(id: string): Project | undefined {
    const existing = this.db.getProject(id);
    if (!existing) return undefined;

    let repoRoot = existing.repo_root;
    let remoteUrl = existing.remote_url;

    if (isGitRepo(existing.directory)) {
      repoRoot = getRepoRoot(existing.directory);
      remoteUrl = getRemoteUrl(existing.directory);
    }

    const row: ProjectRow = {
      ...existing,
      repo_root: repoRoot,
      remote_url: remoteUrl,
    };

    this.db.upsertProject(row);
    return rowToProject(row);
  }

  /** Update last_activity_at for a project. */
  touchProject(id: string): void {
    this.db.updateProjectActivity(id, Date.now());
  }

  /** Get the set of registered project directories (for scoped discovery). */
  getRegisteredDirectories(): Set<string> {
    return new Set(this.db.getAllProjects().map((p: ProjectRow) => p.directory));
  }
}
