/**
 * ProjectManager — manages explicit project registration for Relay.
 *
 * Projects are the organizing primitive: sessions are scoped to projects,
 * external discovery only watches registered project directories.
 * All projects must be git repositories.
 */

import { randomUUID } from "crypto";
import { existsSync, realpathSync } from "fs";
import { basename } from "path";
import { EventEmitter } from "events";

import { SessionDB } from "./db.js";
import type { ProjectRow } from "./db.js";
import type { Project } from "./types.js";
import type { Logger } from "./logger.js";
import {
  isGitRepo,
  getRepoRoot,
  getRemoteUrl,
  getCurrentBranch,
  isRelayWorktreePath,
  resolveWorktreeOrigin,
} from "./git.js";

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
    this.normalizeRegisteredProjects();
  }

  private normalizeRegisteredProjects(): void {
    for (const project of this.db.getAllProjects()) {
      if (!isRelayWorktreePath(project.directory)) {
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
    updates: { name?: string; targetBranch?: string | null },
  ): Project | undefined {
    const existing = this.db.getProject(id);
    if (!existing) return undefined;

    const row: ProjectRow = {
      ...existing,
      name: updates.name ?? existing.name,
      target_branch:
        updates.targetBranch !== undefined ? updates.targetBranch : existing.target_branch,
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
