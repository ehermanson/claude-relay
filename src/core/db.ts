/**
 * SessionDB — SQLite-backed session persistence for Claude Relay
 *
 * Wraps better-sqlite3 with prepared statements for fast, synchronous access.
 * Handles schema migrations, corruption recovery, and index management.
 */

import { mkdirSync, renameSync } from "fs";
import { dirname } from "path";
import Database from "better-sqlite3";
import type { Logger } from "./logger.js";

const CURRENT_SCHEMA_VERSION = 4;

export interface SessionRow {
  session_id: string;
  instance_id: string;
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
  cost_usd: number;
  summary: string | null;
  first_prompt: string | null;
  git_branch: string | null;
  message_count: number;
  allowed_tools: string;
  worktree_path: string | null;
  original_directory: string | null;
  parent_session_id: string | null;
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
  private stmtArchive!: Database.Statement;
  private stmtUnarchive!: Database.Statement;
  private stmtUpdateStats!: Database.Statement;
  private stmtUpdateLastActivity!: Database.Statement;
  private stmtUpdateName!: Database.Statement;
  private stmtGetJsonlPaths!: Database.Statement;
  private stmtDeleteBySessionId!: Database.Statement;
  private stmtUpdateAllowedTools!: Database.Statement;
  private stmtUpdateWorkingDirectory!: Database.Statement;
  private stmtGetProjectStats!: Database.Statement;
  private stmtGetGlobalStats!: Database.Statement;

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
          cost_usd REAL NOT NULL DEFAULT 0,
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
        session_id, instance_id, name, working_directory, jsonl_path,
        created_at, last_activity_at, type, archived, custom_title,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        cost_usd, summary, first_prompt, git_branch, message_count, allowed_tools,
        worktree_path, original_directory, parent_session_id
      ) VALUES (
        @session_id, @instance_id, @name, @working_directory, @jsonl_path,
        @created_at, @last_activity_at, @type, @archived, @custom_title,
        @input_tokens, @output_tokens, @cache_creation_tokens, @cache_read_tokens,
        @cost_usd, @summary, @first_prompt, @git_branch, @message_count, @allowed_tools,
        @worktree_path, @original_directory, @parent_session_id
      )
      ON CONFLICT(session_id) DO UPDATE SET
        instance_id = excluded.instance_id,
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
        cost_usd = excluded.cost_usd,
        summary = excluded.summary,
        first_prompt = excluded.first_prompt,
        git_branch = excluded.git_branch,
        message_count = excluded.message_count,
        allowed_tools = excluded.allowed_tools,
        worktree_path = excluded.worktree_path,
        original_directory = excluded.original_directory,
        parent_session_id = excluded.parent_session_id
    `);

    this.stmtGetBySessionId = this.db.prepare("SELECT * FROM sessions WHERE session_id = ?");

    this.stmtGetByInstanceId = this.db.prepare("SELECT * FROM sessions WHERE instance_id = ?");

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

    this.stmtArchive = this.db.prepare("UPDATE sessions SET archived = 1 WHERE session_id = ?");

    this.stmtUnarchive = this.db.prepare("UPDATE sessions SET archived = 0 WHERE session_id = ?");

    this.stmtUpdateStats = this.db.prepare(`
      UPDATE sessions SET
        input_tokens = @input_tokens,
        output_tokens = @output_tokens,
        cache_creation_tokens = @cache_creation_tokens,
        cache_read_tokens = @cache_read_tokens,
        cost_usd = @cost_usd
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

    this.stmtGetProjectStats = this.db.prepare(`
      SELECT
        COUNT(*) as session_count,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(cost_usd), 0) as cost_usd
      FROM sessions
      WHERE working_directory = ?
    `);

    this.stmtGetGlobalStats = this.db.prepare(`
      SELECT
        COUNT(*) as session_count,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(cost_usd), 0) as cost_usd
      FROM sessions
    `);
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
      costUSD: number;
    },
  ): void {
    this.stmtUpdateStats.run({
      session_id: sessionId,
      input_tokens: stats.inputTokens,
      output_tokens: stats.outputTokens,
      cache_creation_tokens: stats.cacheCreationTokens,
      cache_read_tokens: stats.cacheReadTokens,
      cost_usd: stats.costUSD,
    });
  }

  updateLastActivity(sessionId: string, timestamp: number): void {
    this.stmtUpdateLastActivity.run(timestamp, sessionId);
  }

  updateName(sessionId: string, name: string, customTitle: boolean): void {
    this.stmtUpdateName.run(name, customTitle ? 1 : 0, sessionId);
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

  getProjectStats(workingDirectory: string): {
    sessionCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    costUSD: number;
  } {
    const row = this.stmtGetProjectStats.get(workingDirectory) as {
      session_count: number;
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
      cost_usd: number;
    };
    return {
      sessionCount: row.session_count,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      cacheReadTokens: row.cache_read_tokens,
      costUSD: row.cost_usd,
    };
  }

  getGlobalStats(): {
    sessionCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    costUSD: number;
  } {
    const row = this.stmtGetGlobalStats.get() as {
      session_count: number;
      input_tokens: number;
      output_tokens: number;
      cache_creation_tokens: number;
      cache_read_tokens: number;
      cost_usd: number;
    };
    return {
      sessionCount: row.session_count,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      cacheReadTokens: row.cache_read_tokens,
      costUSD: row.cost_usd,
    };
  }

  deleteBySessionId(sessionId: string): void {
    this.stmtDeleteBySessionId.run(sessionId);
  }

  clear(): void {
    this.db.exec("DELETE FROM sessions");
  }

  close(): void {
    this.db.close();
  }
}
