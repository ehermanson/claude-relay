/**
 * SessionDB — SQLite-backed session persistence for Relay
 *
 * Wraps better-sqlite3 with prepared statements for fast, synchronous access.
 * Handles schema migrations, corruption recovery, and index management.
 */

import { mkdirSync, renameSync } from "fs";
import { dirname } from "path";
import Database from "better-sqlite3";
import type { Logger } from "./logger.js";

const CURRENT_SCHEMA_VERSION = 14;

export interface ProjectRow {
  id: string;
  name: string;
  directory: string;
  repo_root: string | null;
  remote_url: string | null;
  target_branch: string | null;
  created_at: number;
  last_activity_at: number | null;
}

export interface SpaceRow {
  id: string;
  project_directory: string;
  name: string;
  git_branch: string | null;
  worktree_path: string | null;
  is_default: number;
  status: string;
  created_at: number;
  last_activity_at: number;
}

export interface SessionRow {
  session_id: string;
  instance_id: string;
  provider_name: string;
  name: string;
  working_directory: string;
  jsonl_path: string;
  created_at: number;
  last_activity_at: number;
  type: string;
  archived: number;
  custom_title: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  summary: string | null;
  first_prompt: string | null;
  git_branch: string | null;
  message_count: number;
  allowed_tools: string;
  worktree_path: string | null;
  original_directory: string | null;
  parent_session_id: string | null;
  preferred_model: string | null;
  reasoning_budget: number | null;
  skip_permissions: number;
  last_message_text: string | null;
  last_message_from: string | null;
  last_message_at: number | null;
  git_info_branch: string | null;
  git_info_is_worktree: number | null;
  space_id: string | null;
  project_id: string | null;
  model: string | null;
}

export interface ManagedInstanceRow {
  instance_id: string;
  provider_name: string;
  provider_session_id: string | null;
  name: string;
  working_directory: string;
  created_at: number;
  last_activity_at: number;
  archived: number;
  custom_title: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  git_branch: string | null;
  worktree_path: string | null;
  original_directory: string | null;
  parent_session_id: string | null;
  preferred_model: string | null;
  reasoning_budget: number | null;
  skip_permissions: number;
  runtime_mode: string;
  resume_cursor_json: string | null;
  runtime_payload_json: string | null;
  transcript_path: string | null;
  last_message_text: string | null;
  last_message_from: string | null;
  last_message_at: number | null;
  git_info_branch: string | null;
  git_info_is_worktree: number | null;
  space_id: string | null;
  project_id: string | null;
  model: string | null;
}

export class SessionDB {
  private db: Database.Database;
  private logger: Logger;

  /** Set to true if the DB was corrupt and had to be recreated */
  needsRebuild = false;

  // Prepared statements
  private stmtUpsert!: Database.Statement;
  private stmtGetBySessionId!: Database.Statement;
  private stmtGetByInstanceId!: Database.Statement;
  private stmtGetByJsonlPath!: Database.Statement;
  private stmtGetAllActive!: Database.Statement;
  private stmtGetAll!: Database.Statement;
  private stmtGetAllIncludeArchived!: Database.Statement;
  private stmtUpsertManaged!: Database.Statement;
  private stmtGetManagedByInstanceId!: Database.Statement;
  private stmtGetAllManagedActive!: Database.Statement;
  private stmtArchiveManaged!: Database.Statement;
  private stmtArchive!: Database.Statement;
  private stmtUnarchive!: Database.Statement;
  private stmtUpdateStats!: Database.Statement;
  private stmtUpdateLastActivity!: Database.Statement;
  private stmtUpdateName!: Database.Statement;
  private stmtGetJsonlPaths!: Database.Statement;
  private stmtDeleteBySessionId!: Database.Statement;
  private stmtUpdateAllowedTools!: Database.Statement;
  private stmtUpdateWorkingDirectory!: Database.Statement;
  private stmtUpdateSessionModel!: Database.Statement;
  private stmtUpdatePreferredModel!: Database.Statement;
  private stmtUpdateReasoningBudget!: Database.Statement;
  private stmtUpdateSkipPermissions!: Database.Statement;
  private stmtGetProjectStats!: Database.Statement;
  private stmtGetGlobalStats!: Database.Statement;
  private stmtUpsertProject!: Database.Statement;
  private stmtGetProject!: Database.Statement;
  private stmtGetProjectByDir!: Database.Statement;
  private stmtGetAllProjects!: Database.Statement;
  private stmtDeleteProject!: Database.Statement;
  private stmtUpdateProjectActivity!: Database.Statement;
  private stmtUpdateSessionProjectId!: Database.Statement;
  private stmtUpdateManagedSessionProjectId!: Database.Statement;
  private stmtUpdateSpaceProjectDirectory!: Database.Statement;
  private stmtGetDistinctSessionDirs!: Database.Statement;
  private stmtGetProjectModelStats!: Database.Statement;
  private stmtUpsertSpace!: Database.Statement;
  private stmtGetSpace!: Database.Statement;
  private stmtGetSpacesByProject!: Database.Statement;
  private stmtGetDefaultSpace!: Database.Statement;
  private stmtUpdateSpaceStatus!: Database.Statement;
  private stmtUpdateSpaceActivity!: Database.Statement;
  private stmtDeleteSpace!: Database.Statement;
  private stmtGetSpaceChatCount!: Database.Statement;
  private stmtUpdateSessionSpaceId!: Database.Statement;
  private stmtUpdateManagedSpaceId!: Database.Statement;

  constructor(dbPath: string, logger: Logger) {
    this.logger = logger;

    // Ensure the directory exists
    mkdirSync(dirname(dbPath), { recursive: true });

    try {
      this.db = new Database(dbPath);
    } catch {
      // Corrupted file — rename and retry
      logger.warn(`[SessionDB] Database corrupted, recreating: ${dbPath}`);
      try {
        renameSync(dbPath, `${dbPath}.corrupt.${Date.now()}`);
      } catch {
        // ignore rename errors
      }
      this.db = new Database(dbPath);
      this.needsRebuild = true;
    }

    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 3000");

    this.migrate();
    this.prepareStatements();
  }

  private migrate(): void {
    // Create schema_version table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL
      )
    `);

    const versionRow = this.db.prepare("SELECT version FROM schema_version LIMIT 1").get() as
      | { version: number }
      | undefined;

    const currentVersion = versionRow?.version ?? 0;

    if (currentVersion < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          session_id TEXT PRIMARY KEY,
          instance_id TEXT NOT NULL UNIQUE,
          provider_name TEXT NOT NULL DEFAULT 'claude',
          name TEXT NOT NULL,
          working_directory TEXT NOT NULL,
          jsonl_path TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL,
          last_activity_at INTEGER NOT NULL,
          type TEXT NOT NULL DEFAULT 'external',
          archived INTEGER NOT NULL DEFAULT 0,
          custom_title INTEGER NOT NULL DEFAULT 0,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
          cache_read_tokens INTEGER NOT NULL DEFAULT 0,
          summary TEXT,
          first_prompt TEXT,
          git_branch TEXT,
          message_count INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_working_directory ON sessions(working_directory);
        CREATE INDEX IF NOT EXISTS idx_sessions_archived ON sessions(archived);
        CREATE INDEX IF NOT EXISTS idx_sessions_last_activity_at ON sessions(last_activity_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_jsonl_path ON sessions(jsonl_path);
      `);
    }

    {
      const cols = this.db.pragma("table_info(sessions)") as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "provider_name")) {
        this.db.exec(
          `ALTER TABLE sessions ADD COLUMN provider_name TEXT NOT NULL DEFAULT 'claude'`,
        );
      }
    }

    // v2: add allowed_tools column — always check for the column regardless of version
    // because a previous migration may have updated the version without adding the column
    {
      const cols = this.db.pragma("table_info(sessions)") as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "allowed_tools")) {
        this.db.exec(`
          ALTER TABLE sessions ADD COLUMN allowed_tools TEXT NOT NULL DEFAULT '[]'
        `);
      }
    }

    // v3: add worktree_path and original_directory columns for git worktree isolation
    {
      const cols = this.db.pragma("table_info(sessions)") as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "worktree_path")) {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN worktree_path TEXT`);
      }
      if (!cols.some((c) => c.name === "original_directory")) {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN original_directory TEXT`);
      }
    }

    // v4: add parent_session_id column for plan-parent linking
    {
      const cols = this.db.pragma("table_info(sessions)") as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "parent_session_id")) {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN parent_session_id TEXT`);
      }
    }

    // v5: add preferred_model column for per-instance model selection
    {
      const cols = this.db.pragma("table_info(sessions)") as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "preferred_model")) {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN preferred_model TEXT`);
      }
    }

    // v6: add reasoning_budget column for per-instance thinking limits
    {
      const cols = this.db.pragma("table_info(sessions)") as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "reasoning_budget")) {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN reasoning_budget INTEGER`);
      }
    }

    // v7: add skip_permissions column for persisting full-access mode
    {
      const cols = this.db.pragma("table_info(sessions)") as Array<{ name: string }>;
      if (!cols.some((c) => c.name === "skip_permissions")) {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN skip_permissions INTEGER NOT NULL DEFAULT 0`);
      }
    }

    // v8: provider-aware managed session bindings
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS managed_sessions (
        instance_id TEXT PRIMARY KEY,
        provider_name TEXT NOT NULL,
        provider_session_id TEXT,
        name TEXT NOT NULL,
        working_directory TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        custom_title INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        git_branch TEXT,
        worktree_path TEXT,
        original_directory TEXT,
        parent_session_id TEXT,
        preferred_model TEXT,
        reasoning_budget INTEGER,
        skip_permissions INTEGER NOT NULL DEFAULT 0,
        runtime_mode TEXT NOT NULL DEFAULT 'approval-required',
        resume_cursor_json TEXT,
        runtime_payload_json TEXT,
        transcript_path TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_managed_sessions_provider ON managed_sessions(provider_name);
      CREATE INDEX IF NOT EXISTS idx_managed_sessions_archived ON managed_sessions(archived);
      CREATE INDEX IF NOT EXISTS idx_managed_sessions_working_directory ON managed_sessions(working_directory);
      CREATE INDEX IF NOT EXISTS idx_managed_sessions_provider_session_id ON managed_sessions(provider_session_id);
    `);

    // v9: add last_message columns for lazy hydration (sidebar preview without JSONL parse)
    {
      const sessionCols = this.db.pragma("table_info(sessions)") as Array<{ name: string }>;
      if (!sessionCols.some((c) => c.name === "last_message_text")) {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN last_message_text TEXT`);
        this.db.exec(`ALTER TABLE sessions ADD COLUMN last_message_from TEXT`);
        this.db.exec(`ALTER TABLE sessions ADD COLUMN last_message_at INTEGER`);
      }
      const managedCols = this.db.pragma("table_info(managed_sessions)") as Array<{
        name: string;
      }>;
      if (!managedCols.some((c) => c.name === "last_message_text")) {
        this.db.exec(`ALTER TABLE managed_sessions ADD COLUMN last_message_text TEXT`);
        this.db.exec(`ALTER TABLE managed_sessions ADD COLUMN last_message_from TEXT`);
        this.db.exec(`ALTER TABLE managed_sessions ADD COLUMN last_message_at INTEGER`);
      }
    }

    // v10: persist git metadata so sidebar grouping/icons can render from DB
    {
      const sessionCols = this.db.pragma("table_info(sessions)") as Array<{ name: string }>;
      if (!sessionCols.some((c) => c.name === "git_info_branch")) {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN git_info_branch TEXT`);
        this.db.exec(`ALTER TABLE sessions ADD COLUMN git_info_is_worktree INTEGER`);
      }
      const managedCols = this.db.pragma("table_info(managed_sessions)") as Array<{
        name: string;
      }>;
      if (!managedCols.some((c) => c.name === "git_info_branch")) {
        this.db.exec(`ALTER TABLE managed_sessions ADD COLUMN git_info_branch TEXT`);
        this.db.exec(`ALTER TABLE managed_sessions ADD COLUMN git_info_is_worktree INTEGER`);
      }
    }

    // v12: explicit projects table + project_id FK on sessions
    this.db.exec(`DROP TABLE IF EXISTS hidden_directories`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        directory TEXT NOT NULL UNIQUE,
        repo_root TEXT,
        remote_url TEXT,
        target_branch TEXT,
        created_at INTEGER NOT NULL,
        last_activity_at INTEGER
      )
    `);
    {
      const sessionCols = this.db.pragma("table_info(sessions)") as Array<{ name: string }>;
      if (!sessionCols.some((c) => c.name === "project_id")) {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN project_id TEXT`);
      }
      const managedCols = this.db.pragma("table_info(managed_sessions)") as Array<{
        name: string;
      }>;
      if (!managedCols.some((c) => c.name === "project_id")) {
        this.db.exec(`ALTER TABLE managed_sessions ADD COLUMN project_id TEXT`);
      }
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id)`);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_managed_sessions_project_id ON managed_sessions(project_id)`,
    );

    // v13: persist actual model ID from API responses
    {
      const sessionCols = this.db.pragma("table_info(sessions)") as Array<{ name: string }>;
      if (!sessionCols.some((c) => c.name === "model")) {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN model TEXT`);
      }
      const managedCols = this.db.pragma("table_info(managed_sessions)") as Array<{
        name: string;
      }>;
      if (!managedCols.some((c) => c.name === "model")) {
        this.db.exec(`ALTER TABLE managed_sessions ADD COLUMN model TEXT`);
      }
    }

    // v14: spaces table + space_id columns on sessions/managed_sessions
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS spaces (
        id TEXT PRIMARY KEY,
        project_directory TEXT NOT NULL,
        name TEXT NOT NULL,
        git_branch TEXT,
        worktree_path TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_spaces_project_directory ON spaces(project_directory);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_default_per_project
        ON spaces(project_directory) WHERE is_default = 1;
    `);
    {
      const sessionCols = this.db.pragma("table_info(sessions)") as Array<{ name: string }>;
      if (!sessionCols.some((c) => c.name === "space_id")) {
        this.db.exec(`ALTER TABLE sessions ADD COLUMN space_id TEXT`);
      }
      const managedCols = this.db.pragma("table_info(managed_sessions)") as Array<{
        name: string;
      }>;
      if (!managedCols.some((c) => c.name === "space_id")) {
        this.db.exec(`ALTER TABLE managed_sessions ADD COLUMN space_id TEXT`);
      }
    }

    // Update version
    if (currentVersion === 0) {
      this.db.exec(`INSERT INTO schema_version (version) VALUES (${CURRENT_SCHEMA_VERSION})`);
    } else if (currentVersion < CURRENT_SCHEMA_VERSION) {
      this.db.exec(`UPDATE schema_version SET version = ${CURRENT_SCHEMA_VERSION}`);
    }
  }

  private prepareStatements(): void {
    this.stmtUpsert = this.db.prepare(`
      INSERT INTO sessions (
        session_id, instance_id, provider_name, name, working_directory, jsonl_path,
        created_at, last_activity_at, type, archived, custom_title,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        summary, first_prompt, git_branch, message_count, allowed_tools,
        worktree_path, original_directory, parent_session_id, preferred_model, reasoning_budget, skip_permissions,
        last_message_text, last_message_from, last_message_at,
        git_info_branch, git_info_is_worktree, space_id, project_id, model
      ) VALUES (
        @session_id, @instance_id, @provider_name, @name, @working_directory, @jsonl_path,
        @created_at, @last_activity_at, @type, @archived, @custom_title,
        @input_tokens, @output_tokens, @cache_creation_tokens, @cache_read_tokens,
        @summary, @first_prompt, @git_branch, @message_count, @allowed_tools,
        @worktree_path, @original_directory, @parent_session_id, @preferred_model, @reasoning_budget, @skip_permissions,
        @last_message_text, @last_message_from, @last_message_at,
        @git_info_branch, @git_info_is_worktree, @space_id, @project_id, @model
      )
      ON CONFLICT(session_id) DO UPDATE SET
        instance_id = excluded.instance_id,
        provider_name = excluded.provider_name,
        name = excluded.name,
        working_directory = excluded.working_directory,
        jsonl_path = excluded.jsonl_path,
        last_activity_at = excluded.last_activity_at,
        type = excluded.type,
        archived = excluded.archived,
        custom_title = excluded.custom_title,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cache_creation_tokens = excluded.cache_creation_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        summary = excluded.summary,
        first_prompt = excluded.first_prompt,
        git_branch = excluded.git_branch,
        message_count = excluded.message_count,
        allowed_tools = excluded.allowed_tools,
        worktree_path = excluded.worktree_path,
        original_directory = excluded.original_directory,
        parent_session_id = excluded.parent_session_id,
        preferred_model = excluded.preferred_model,
        reasoning_budget = excluded.reasoning_budget,
        skip_permissions = excluded.skip_permissions,
        last_message_text = excluded.last_message_text,
        last_message_from = excluded.last_message_from,
        last_message_at = excluded.last_message_at,
        git_info_branch = excluded.git_info_branch,
        git_info_is_worktree = excluded.git_info_is_worktree,
        space_id = excluded.space_id,
        project_id = excluded.project_id,
        model = excluded.model
    `);

    this.stmtUpsertManaged = this.db.prepare(`
      INSERT INTO managed_sessions (
        instance_id, provider_name, provider_session_id, name, working_directory,
        created_at, last_activity_at, archived, custom_title,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        git_branch, worktree_path, original_directory, parent_session_id,
        preferred_model, reasoning_budget, skip_permissions, runtime_mode,
        resume_cursor_json, runtime_payload_json, transcript_path,
        last_message_text, last_message_from, last_message_at,
        git_info_branch, git_info_is_worktree, space_id, project_id, model
      ) VALUES (
        @instance_id, @provider_name, @provider_session_id, @name, @working_directory,
        @created_at, @last_activity_at, @archived, @custom_title,
        @input_tokens, @output_tokens, @cache_creation_tokens, @cache_read_tokens,
        @git_branch, @worktree_path, @original_directory, @parent_session_id,
        @preferred_model, @reasoning_budget, @skip_permissions, @runtime_mode,
        @resume_cursor_json, @runtime_payload_json, @transcript_path,
        @last_message_text, @last_message_from, @last_message_at,
        @git_info_branch, @git_info_is_worktree, @space_id, @project_id, @model
      )
      ON CONFLICT(instance_id) DO UPDATE SET
        provider_name = excluded.provider_name,
        provider_session_id = excluded.provider_session_id,
        name = excluded.name,
        working_directory = excluded.working_directory,
        last_activity_at = excluded.last_activity_at,
        archived = excluded.archived,
        custom_title = excluded.custom_title,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cache_creation_tokens = excluded.cache_creation_tokens,
        cache_read_tokens = excluded.cache_read_tokens,
        git_branch = excluded.git_branch,
        worktree_path = excluded.worktree_path,
        original_directory = excluded.original_directory,
        parent_session_id = excluded.parent_session_id,
        preferred_model = excluded.preferred_model,
        reasoning_budget = excluded.reasoning_budget,
        skip_permissions = excluded.skip_permissions,
        runtime_mode = excluded.runtime_mode,
        resume_cursor_json = excluded.resume_cursor_json,
        runtime_payload_json = excluded.runtime_payload_json,
        transcript_path = excluded.transcript_path,
        last_message_text = excluded.last_message_text,
        last_message_from = excluded.last_message_from,
        last_message_at = excluded.last_message_at,
        git_info_branch = excluded.git_info_branch,
        git_info_is_worktree = excluded.git_info_is_worktree,
        space_id = excluded.space_id,
        project_id = excluded.project_id,
        model = excluded.model
    `);

    this.stmtGetBySessionId = this.db.prepare("SELECT * FROM sessions WHERE session_id = ?");

    this.stmtGetByInstanceId = this.db.prepare("SELECT * FROM sessions WHERE instance_id = ?");

    this.stmtGetManagedByInstanceId = this.db.prepare(
      "SELECT * FROM managed_sessions WHERE instance_id = ?",
    );

    this.stmtGetByJsonlPath = this.db.prepare("SELECT * FROM sessions WHERE jsonl_path = ?");

    this.stmtGetAllActive = this.db.prepare(
      "SELECT * FROM sessions WHERE archived = 0 ORDER BY last_activity_at DESC",
    );

    this.stmtGetAll = this.db.prepare(
      "SELECT * FROM sessions WHERE archived = 0 ORDER BY last_activity_at DESC",
    );

    this.stmtGetAllIncludeArchived = this.db.prepare(
      "SELECT * FROM sessions ORDER BY last_activity_at DESC",
    );

    this.stmtGetAllManagedActive = this.db.prepare(
      "SELECT * FROM managed_sessions WHERE archived = 0 ORDER BY last_activity_at DESC",
    );

    this.stmtArchive = this.db.prepare("UPDATE sessions SET archived = 1 WHERE session_id = ?");

    this.stmtArchiveManaged = this.db.prepare(
      "UPDATE managed_sessions SET archived = 1 WHERE instance_id = ?",
    );

    this.stmtUnarchive = this.db.prepare("UPDATE sessions SET archived = 0 WHERE session_id = ?");

    this.stmtUpdateStats = this.db.prepare(`
      UPDATE sessions SET
        input_tokens = @input_tokens,
        output_tokens = @output_tokens,
        cache_creation_tokens = @cache_creation_tokens,
        cache_read_tokens = @cache_read_tokens
      WHERE session_id = @session_id
    `);

    this.stmtUpdateLastActivity = this.db.prepare(
      "UPDATE sessions SET last_activity_at = ? WHERE session_id = ?",
    );

    this.stmtUpdateName = this.db.prepare(
      "UPDATE sessions SET name = ?, custom_title = ? WHERE session_id = ?",
    );

    this.stmtGetJsonlPaths = this.db.prepare("SELECT jsonl_path FROM sessions");

    this.stmtDeleteBySessionId = this.db.prepare("DELETE FROM sessions WHERE session_id = ?");

    this.stmtUpdateAllowedTools = this.db.prepare(
      "UPDATE sessions SET allowed_tools = ? WHERE session_id = ?",
    );

    this.stmtUpdateWorkingDirectory = this.db.prepare(
      "UPDATE sessions SET working_directory = ? WHERE session_id = ?",
    );

    this.stmtUpdateSessionModel = this.db.prepare(
      "UPDATE sessions SET model = ? WHERE session_id = ?",
    );

    this.stmtUpdatePreferredModel = this.db.prepare(
      "UPDATE sessions SET preferred_model = ? WHERE session_id = ?",
    );

    this.stmtUpdateReasoningBudget = this.db.prepare(
      "UPDATE sessions SET reasoning_budget = ? WHERE session_id = ?",
    );

    this.stmtUpdateSkipPermissions = this.db.prepare(
      "UPDATE sessions SET skip_permissions = ? WHERE session_id = ?",
    );

    this.stmtGetProjectStats = this.db.prepare(`
      SELECT
        COALESCE(SUM(session_count), 0) as session_count,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens
      FROM (
        SELECT
          COUNT(*) as session_count,
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
          COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens
        FROM sessions
        WHERE archived = 0 AND type = 'external' AND working_directory = ?
        UNION ALL
        SELECT
          COUNT(*) as session_count,
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
          COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens
        FROM managed_sessions
        WHERE archived = 0 AND working_directory = ?
      )
    `);

    this.stmtGetGlobalStats = this.db.prepare(`
      SELECT
        COALESCE(SUM(session_count), 0) as session_count,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens
      FROM (
        SELECT
          COUNT(*) as session_count,
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
          COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens
        FROM sessions
        WHERE archived = 0 AND type = 'external'
        UNION ALL
        SELECT
          COUNT(*) as session_count,
          COALESCE(SUM(input_tokens), 0) as input_tokens,
          COALESCE(SUM(output_tokens), 0) as output_tokens,
          COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
          COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens
        FROM managed_sessions
        WHERE archived = 0
      )
    `);

    // Project CRUD
    this.stmtUpsertProject = this.db.prepare(`
      INSERT INTO projects (id, name, directory, repo_root, remote_url, target_branch, created_at, last_activity_at)
      VALUES (@id, @name, @directory, @repo_root, @remote_url, @target_branch, @created_at, @last_activity_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        directory = excluded.directory,
        repo_root = excluded.repo_root,
        remote_url = excluded.remote_url,
        target_branch = excluded.target_branch,
        last_activity_at = excluded.last_activity_at
    `);
    this.stmtGetProject = this.db.prepare("SELECT * FROM projects WHERE id = ?");
    this.stmtGetProjectByDir = this.db.prepare("SELECT * FROM projects WHERE directory = ?");
    this.stmtGetAllProjects = this.db.prepare(
      "SELECT * FROM projects ORDER BY last_activity_at DESC NULLS LAST, created_at DESC",
    );
    this.stmtDeleteProject = this.db.prepare("DELETE FROM projects WHERE id = ?");
    this.stmtUpdateProjectActivity = this.db.prepare(
      "UPDATE projects SET last_activity_at = ? WHERE id = ?",
    );
    this.stmtUpdateSessionProjectId = this.db.prepare(
      "UPDATE sessions SET project_id = ? WHERE working_directory = ?",
    );
    this.stmtUpdateManagedSessionProjectId = this.db.prepare(
      "UPDATE managed_sessions SET project_id = ? WHERE working_directory = ?",
    );
    this.stmtUpdateSpaceProjectDirectory = this.db.prepare(
      "UPDATE spaces SET project_directory = ? WHERE project_directory = ?",
    );
    this.stmtGetDistinctSessionDirs = this.db.prepare(`
      SELECT DISTINCT working_directory FROM (
        SELECT working_directory FROM sessions WHERE archived = 0
        UNION
        SELECT working_directory FROM managed_sessions WHERE archived = 0
      )
    `);
    this.stmtGetProjectModelStats = this.db.prepare(`
      SELECT
        model,
        provider_name,
        COALESCE(SUM(session_count), 0) as session_count,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens
      FROM (
        SELECT model, provider_name, COUNT(*) as session_count,
          SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens,
          SUM(cache_creation_tokens) as cache_creation_tokens, SUM(cache_read_tokens) as cache_read_tokens
        FROM sessions WHERE archived = 0 AND working_directory = ? AND model IS NOT NULL
        GROUP BY model, provider_name
        UNION ALL
        SELECT model, provider_name, COUNT(*) as session_count,
          SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens,
          SUM(cache_creation_tokens) as cache_creation_tokens, SUM(cache_read_tokens) as cache_read_tokens
        FROM managed_sessions WHERE archived = 0 AND working_directory = ? AND model IS NOT NULL
        GROUP BY model, provider_name
      )
      GROUP BY model, provider_name
      ORDER BY (input_tokens + output_tokens) DESC
    `);

    // Space statements
    this.stmtUpsertSpace = this.db.prepare(`
      INSERT INTO spaces (id, project_directory, name, git_branch, worktree_path, is_default, status, created_at, last_activity_at)
      VALUES (@id, @project_directory, @name, @git_branch, @worktree_path, @is_default, @status, @created_at, @last_activity_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        git_branch = excluded.git_branch,
        worktree_path = excluded.worktree_path,
        status = excluded.status,
        last_activity_at = excluded.last_activity_at
    `);
    this.stmtGetSpace = this.db.prepare("SELECT * FROM spaces WHERE id = ?");
    this.stmtGetSpacesByProject = this.db.prepare(
      "SELECT * FROM spaces WHERE project_directory = ? AND status != 'archived' ORDER BY is_default DESC, last_activity_at DESC",
    );
    this.stmtGetDefaultSpace = this.db.prepare(
      "SELECT * FROM spaces WHERE project_directory = ? AND is_default = 1 LIMIT 1",
    );
    this.stmtUpdateSpaceStatus = this.db.prepare("UPDATE spaces SET status = ? WHERE id = ?");
    this.stmtUpdateSpaceActivity = this.db.prepare(
      "UPDATE spaces SET last_activity_at = ? WHERE id = ?",
    );
    this.stmtDeleteSpace = this.db.prepare("DELETE FROM spaces WHERE id = ?");
    this.stmtGetSpaceChatCount = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM sessions WHERE space_id = ? AND archived = 0) +
        (SELECT COUNT(*) FROM managed_sessions WHERE space_id = ? AND archived = 0)
      AS count
    `);
    this.stmtUpdateSessionSpaceId = this.db.prepare(
      "UPDATE sessions SET space_id = ? WHERE session_id = ?",
    );
    this.stmtUpdateManagedSpaceId = this.db.prepare(
      "UPDATE managed_sessions SET space_id = ? WHERE instance_id = ?",
    );
  }

  upsert(row: SessionRow): void {
    this.stmtUpsert.run(row);
  }

  upsertMany(rows: SessionRow[]): void {
    const tx = this.db.transaction((items: SessionRow[]) => {
      for (const row of items) {
        this.stmtUpsert.run(row);
      }
    });
    tx(rows);
  }

  getBySessionId(sessionId: string): SessionRow | undefined {
    return this.stmtGetBySessionId.get(sessionId) as SessionRow | undefined;
  }

  getByInstanceId(instanceId: string): SessionRow | undefined {
    return this.stmtGetByInstanceId.get(instanceId) as SessionRow | undefined;
  }

  getManagedByInstanceId(instanceId: string): ManagedInstanceRow | undefined {
    return this.stmtGetManagedByInstanceId.get(instanceId) as ManagedInstanceRow | undefined;
  }

  getByJsonlPath(jsonlPath: string): SessionRow | undefined {
    return this.stmtGetByJsonlPath.get(jsonlPath) as SessionRow | undefined;
  }

  getAllActive(): SessionRow[] {
    return this.stmtGetAllActive.all() as SessionRow[];
  }

  getAll(includeArchived = false): SessionRow[] {
    if (includeArchived) {
      return this.stmtGetAllIncludeArchived.all() as SessionRow[];
    }
    return this.stmtGetAll.all() as SessionRow[];
  }

  archive(sessionId: string): void {
    this.stmtArchive.run(sessionId);
  }

  upsertManaged(row: ManagedInstanceRow): void {
    this.stmtUpsertManaged.run(row);
  }

  getAllManagedActive(): ManagedInstanceRow[] {
    return this.stmtGetAllManagedActive.all() as ManagedInstanceRow[];
  }

  archiveManaged(instanceId: string): void {
    this.stmtArchiveManaged.run(instanceId);
  }

  unarchive(sessionId: string): void {
    this.stmtUnarchive.run(sessionId);
  }

  updateStats(
    sessionId: string,
    stats: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
    },
  ): void {
    this.stmtUpdateStats.run({
      session_id: sessionId,
      input_tokens: stats.inputTokens,
      output_tokens: stats.outputTokens,
      cache_creation_tokens: stats.cacheCreationTokens,
      cache_read_tokens: stats.cacheReadTokens,
    });
  }

  updateLastActivity(sessionId: string, timestamp: number): void {
    this.stmtUpdateLastActivity.run(timestamp, sessionId);
  }

  updateName(sessionId: string, name: string, customTitle: boolean): void {
    this.stmtUpdateName.run(name, customTitle ? 1 : 0, sessionId);
  }

  updateProvider(sessionId: string, provider: string): void {
    this.db
      .prepare("UPDATE sessions SET provider_name = ? WHERE session_id = ?")
      .run(provider, sessionId);
  }

  updateAllowedTools(sessionId: string, tools: string[]): void {
    this.stmtUpdateAllowedTools.run(JSON.stringify(tools), sessionId);
  }

  getJsonlPaths(): Set<string> {
    const rows = this.stmtGetJsonlPaths.all() as { jsonl_path: string }[];
    return new Set(rows.map((r) => r.jsonl_path));
  }

  updateWorkingDirectory(sessionId: string, workingDirectory: string): void {
    this.stmtUpdateWorkingDirectory.run(workingDirectory, sessionId);
  }

  updateSessionModel(sessionId: string, model: string | null): void {
    this.stmtUpdateSessionModel.run(model, sessionId);
  }

  updatePreferredModel(sessionId: string, model: string | null): void {
    this.stmtUpdatePreferredModel.run(model, sessionId);
  }

  updateReasoningBudget(sessionId: string, budget: number | null): void {
    this.stmtUpdateReasoningBudget.run(budget, sessionId);
  }

  updateSkipPermissions(sessionId: string, skip: boolean): void {
    this.stmtUpdateSkipPermissions.run(skip ? 1 : 0, sessionId);
  }

  getProjectStats(workingDirectory: string): {
    sessionCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  } {
    const row = this.stmtGetProjectStats.get(workingDirectory, workingDirectory) as {
      session_count: number;
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
    };
    return {
      sessionCount: row.session_count,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      cacheReadTokens: row.cache_read_tokens,
    };
  }

  getGlobalStats(): {
    sessionCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  } {
    const row = this.stmtGetGlobalStats.get() as {
      session_count: number;
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
    };
    return {
      sessionCount: row.session_count,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      cacheReadTokens: row.cache_read_tokens,
    };
  }

  deleteBySessionId(sessionId: string): void {
    this.stmtDeleteBySessionId.run(sessionId);
  }

  // =========================================================================
  // Project CRUD
  // =========================================================================

  upsertProject(row: ProjectRow): void {
    this.stmtUpsertProject.run(row);
  }

  getProject(id: string): ProjectRow | undefined {
    return this.stmtGetProject.get(id) as ProjectRow | undefined;
  }

  getProjectByDirectory(directory: string): ProjectRow | undefined {
    return this.stmtGetProjectByDir.get(directory) as ProjectRow | undefined;
  }

  getAllProjects(): ProjectRow[] {
    return this.stmtGetAllProjects.all() as ProjectRow[];
  }

  deleteProject(id: string): void {
    this.stmtDeleteProject.run(id);
  }

  updateProjectActivity(id: string, timestamp: number): void {
    this.stmtUpdateProjectActivity.run(timestamp, id);
  }

  /** Bulk-assign project_id to all sessions matching a working directory */
  assignSessionsToProject(projectId: string | null, directory: string): void {
    this.stmtUpdateSessionProjectId.run(projectId, directory);
    this.stmtUpdateManagedSessionProjectId.run(projectId, directory);
  }

  reassignSpacesToProjectDirectory(nextDirectory: string, previousDirectory: string): void {
    this.stmtUpdateSpaceProjectDirectory.run(nextDirectory, previousDirectory);
  }

  /** Get token usage breakdown by model for a project directory */
  getProjectModelStats(workingDirectory: string): Array<{
    model: string;
    providerName: string;
    sessionCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  }> {
    const rows = this.stmtGetProjectModelStats.all(workingDirectory, workingDirectory) as Array<{
      model: string;
      provider_name: string;
      session_count: number;
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
    }>;
    return rows.map((r) => ({
      model: r.model,
      providerName: r.provider_name,
      sessionCount: r.session_count,
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cacheCreationTokens: r.cache_creation_tokens,
      cacheReadTokens: r.cache_read_tokens,
    }));
  }

  /** Get distinct working directories from active sessions (for migration backfill) */
  getDistinctSessionDirectories(): string[] {
    const rows = this.stmtGetDistinctSessionDirs.all() as { working_directory: string }[];
    return rows.map((r) => r.working_directory);
  }

  // =========================================================================
  // Space methods
  // =========================================================================

  upsertSpace(row: SpaceRow): void {
    this.stmtUpsertSpace.run(row);
  }

  getSpace(id: string): SpaceRow | undefined {
    return this.stmtGetSpace.get(id) as SpaceRow | undefined;
  }

  getSpacesByProject(projectDirectory: string): SpaceRow[] {
    return this.stmtGetSpacesByProject.all(projectDirectory) as SpaceRow[];
  }

  getDefaultSpace(projectDirectory: string): SpaceRow | undefined {
    return this.stmtGetDefaultSpace.get(projectDirectory) as SpaceRow | undefined;
  }

  updateSpaceStatus(id: string, status: string): void {
    this.stmtUpdateSpaceStatus.run(status, id);
  }

  updateSpaceActivity(id: string, timestamp: number): void {
    this.stmtUpdateSpaceActivity.run(timestamp, id);
  }

  deleteSpace(id: string): void {
    this.stmtDeleteSpace.run(id);
  }

  getSpaceChatCount(spaceId: string): number {
    const row = this.stmtGetSpaceChatCount.get(spaceId, spaceId) as { count: number };
    return row.count;
  }

  updateSessionSpaceId(sessionId: string, spaceId: string | null): void {
    this.stmtUpdateSessionSpaceId.run(spaceId, sessionId);
  }

  updateManagedSpaceId(instanceId: string, spaceId: string | null): void {
    this.stmtUpdateManagedSpaceId.run(spaceId, instanceId);
  }

  clear(): void {
    this.db.exec("DELETE FROM sessions");
    this.db.exec("DELETE FROM managed_sessions");
    this.db.exec("DELETE FROM spaces");
  }

  close(): void {
    this.db.close();
  }
}
