/**
 * Instance Manager for Claude Relay
 *
 * Manages multiple Claude Code instances, each with its own
 * ClaudeProcess, metadata, and conversation history.
 *
 * Also discovers and monitors externally-running Claude Code sessions
 * by watching ~/.claude/session-env/ and their JSONL transcript files.
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import {
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync, execFileSync } from "child_process";
import { ClaudeProcess } from "./claude-process.js";
import { SessionDB } from "./db.js";
import type { SessionRow } from "./db.js";
import type { CoreConfig } from "./config.js";
import type {
  ServerMessage,
  OutputMessage,
  ExitMessage,
  ActivityMessage,
  UserMessage,
  InstanceStatus,
  LastMessagePreview,
  InstanceInfo,
  HistoryEntry,
  TaskItem,
  FileChange,
  SessionStats,
  TeamInfo,
  ProjectArtifacts,
  ProjectPlan,
} from "./types.js";
import {
  describeToolUse,
  describeToolDetail,
  extractInputDescription,
  extractToolResultText,
  isPermissionDenial,
  INTERACTIVE_TOOLS,
  estimateCost,
} from "./tools.js";
import { getRepoRoot, createWorktree, removeWorktree } from "./git.js";

// =============================================================================
// Re-exports
// =============================================================================

export type { InstanceStatus, LastMessagePreview, InstanceInfo, HistoryEntry } from "./types.js";

// =============================================================================
// Internal Types
// =============================================================================

interface ExternalState {
  jsonlPath: string;
  sessionId: string;
}

interface WatchState {
  jsonlPath: string;
  fileOffset: number;
  /** Tracks tool_use_id → tool name for permission denial attribution */
  pendingTools: Map<string, string>;
  pendingTaskCreates: Map<string, { subject: string; activeForm?: string }>;
  stats: SessionStats;
}

interface Instance {
  info: InstanceInfo;
  process: ClaudeProcess | null;
  history: HistoryEntry[];
  externalState?: ExternalState;
  /** JSONL file watching state — independent of external vs managed */
  watchState?: WatchState;
  /** Auto-generate a title from the first user message */
  autoTitle?: boolean;
  /** Claude Code session ID (captured after first message exchange) */
  sessionId?: string;
  /** Path to the JSONL transcript file for this session */
  jsonlPath?: string;
  /** Accumulated task list state for task_list activity rendering */
  tasks?: Map<string, TaskItem>;
  /** Accumulated file change state for file_list activity rendering */
  files?: Map<string, FileChange>;
  /** Team orchestration state for team_info activity rendering */
  team?: TeamInfo;
  /** Queued retry message when tool approval arrives while process is still running */
  pendingRetry?: string;
  /** Path to the git worktree (if this instance runs in isolation) */
  worktreePath?: string;
  /** Git branch name for this instance's worktree */
  gitBranch?: string;
  /** Original project directory before worktree substitution */
  originalDirectory?: string;
  /** Actual CWD passed to ClaudeProcess (worktree path or original) */
  actualCwd?: string;
}

export interface InstanceManagerEvents {
  "instance:output": [instanceId: string, message: OutputMessage];
  "instance:activity": [instanceId: string, message: ActivityMessage];
  "instance:exit": [instanceId: string, message: ExitMessage];
  "instance:status": [instanceId: string, info: InstanceInfo];
  "instance:created": [instanceId: string, info: InstanceInfo];
  "instance:removed": [instanceId: string];
  "instance:user": [instanceId: string, message: UserMessage];
}

export interface InstanceManager {
  on<E extends keyof InstanceManagerEvents>(
    event: E,
    listener: (...args: InstanceManagerEvents[E]) => void,
  ): this;
  emit<E extends keyof InstanceManagerEvents>(event: E, ...args: InstanceManagerEvents[E]): boolean;
  off<E extends keyof InstanceManagerEvents>(
    event: E,
    listener: (...args: InstanceManagerEvents[E]) => void,
  ): this;
}

// =============================================================================
// InstanceManager Class
// =============================================================================

const MAX_HISTORY = 1000;
const DISCOVERY_INTERVAL = 10_000; // 10s
const WATCH_POLL_INTERVAL = 2_000; // 2s
const MAX_TITLE_LENGTH = 50;
const STITCH_WINDOW_MS = 60_000; // 60s — max gap to stitch sessions
const PLAN_TRANSCRIPT_RE = /read the full transcript at:\s*(\S+\.jsonl)/;
const TASK_TOOLS = new Set(["TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TodoWrite"]);
const FILE_WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);
const FILE_WRITE_GROUP = ["Edit", "Write", "NotebookEdit"];

/**
 * Strip internal Claude CLI XML tags from message text.
 * These are metadata injected by the CLI (system reminders, local command
 * wrappers, hook output, IDE events, etc.) and should never be shown to users.
 * Returns the cleaned text, or empty string if nothing meaningful remains.
 */
const INTERNAL_TAGS = [
  "system-reminder",
  "local-command-caveat",
  "command-name",
  "command-message",
  "command-args",
  "local-command-stdout",
  "user-prompt-submit-hook",
  "ide_opened_file",
  "synthetic",
  "task-notification",
  "task-id",
  "task_id",
  "task_type",
  "retrieval_status",
  "output-file",
  "session-id",
  "project-path",
  "partial_json_fragment",
  "more_fragments",
  "persisted-output",
  "tool_use_error",
];

const INTERNAL_TAG_RE = new RegExp(`<(${INTERNAL_TAGS.join("|")})[^>]*>[\\s\\S]*?</\\1>`, "g");

function stripInternalTags(text: string): string {
  return text.replace(INTERNAL_TAG_RE, "").trim();
}

/** Generate a short session title from the first user message. */
function generateTitle(text: string): string {
  // Take the first line, strip markdown/special chars
  const firstLine = text
    .split("\n")[0]
    .replace(/[#*`_~[\]>]/g, "")
    .trim();
  if (!firstLine) return "New session";
  if (firstLine.length <= MAX_TITLE_LENGTH) return firstLine;
  // Truncate at word boundary
  const truncated = firstLine.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + "\u2026";
}

/**
 * Read cwd from a JSONL file by scanning the first ~32KB for an entry with a `cwd` field.
 * The init/system entry contains `cwd` but isn't always the first line
 * (file-history-snapshot can precede it), and can span many KB.
 */
function readCwdFromJsonl(jsonlPath: string): string | null {
  try {
    const fd = openSync(jsonlPath, "r");
    try {
      const buf = Buffer.alloc(32768);
      const bytesRead = readSync(fd, buf, 0, 32768, 0);
      const text = buf.toString("utf-8", 0, bytesRead);
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.cwd) return parsed.cwd;
        } catch {
          // partial line at end of buffer — skip
        }
      }
    } finally {
      closeSync(fd);
    }
  } catch {
    // file read error
  }
  return null;
}

/**
 * Decode a Claude CLI encoded project directory name back to a filesystem path.
 * Claude encodes `/` → `-`, but decoding `-` → `/` is lossy for paths containing dashes.
 * This uses greedy filesystem validation: builds the path left-to-right, checking
 * `existsSync` at each step, accumulating segments with dashes when `/` doesn't match.
 */
function decodeProjectDir(encodedName: string): string {
  // Strip leading dash (represents the leading /)
  const stripped = encodedName.startsWith("-") ? encodedName.slice(1) : encodedName;
  const segments = stripped.split("-");
  if (segments.length === 0) return "/" + stripped;

  let path = "";
  let accumulator = segments[0];

  for (let i = 1; i < segments.length; i++) {
    // Try treating the separator as / (new path component)
    const candidate = path + "/" + accumulator;
    if (existsSync(candidate)) {
      path = candidate;
      accumulator = segments[i];
    } else {
      // Accumulate with dash (segment is part of a dashed name)
      accumulator += "-" + segments[i];
    }
  }

  // Final segment
  const finalPath = path + "/" + accumulator;
  if (existsSync(finalPath)) return finalPath;

  // If nothing validated, fall back to naive decode but keep dashes for the last component
  // by returning what we've built so far
  return finalPath;
}

// Git info detection with per-directory caching (60s TTL)
const gitInfoCache = new Map<
  string,
  { info: { branch: string; isWorktree: boolean } | null; cachedAt: number }
>();
const GIT_CACHE_TTL = 60_000;

function getGitInfo(dir: string): { branch: string; isWorktree: boolean } | null {
  const cached = gitInfoCache.get(dir);
  if (cached && Date.now() - cached.cachedAt < GIT_CACHE_TTL) return cached.info;

  let info: { branch: string; isWorktree: boolean } | null = null;
  try {
    const opts = { cwd: dir, timeout: 2000, encoding: "utf8" as const };
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], opts).trim();
    const toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], opts).trim();
    info = { branch, isWorktree: toplevel !== dir };
  } catch {
    // Not a git repo or git not available
  }
  gitInfoCache.set(dir, { info, cachedAt: Date.now() });
  return info;
}

/** Extract the last user or claude message from parsed history for dashboard preview. */
function extractLastMessage(history: HistoryEntry[]): LastMessagePreview | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i].message;
    if (msg.type === "user" && (msg as UserMessage).text) {
      return {
        text: (msg as UserMessage).text,
        from: "user",
        timestamp: history[i].timestamp,
      };
    } else if (msg.type === "output") {
      const output = msg as OutputMessage;
      if (output.text && output.text.trim() && !output.isWaiting) {
        return { text: output.text, from: "claude", timestamp: history[i].timestamp };
      }
    }
  }
  return undefined;
}

/** Create an initialized WatchState for a JSONL file. */
function createWatchState(
  jsonlPath: string,
  fileOffset: number,
  existingStats?: SessionStats,
): WatchState {
  return {
    jsonlPath,
    fileOffset,
    pendingTools: new Map(),
    pendingTaskCreates: new Map(),
    stats: existingStats
      ? { ...existingStats }
      : {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          costUSD: 0,
        },
  };
}

export class InstanceManager extends EventEmitter {
  private instances = new Map<string, Instance>();
  private baseConfig: CoreConfig;
  private db: SessionDB;
  private instanceCounter = 0;
  private discoveryInterval: ReturnType<typeof setInterval> | null = null;
  private watchIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private claudeDir: string;

  constructor(config: CoreConfig) {
    super();
    this.baseConfig = config;
    this.claudeDir = config.claudeDir ?? join(homedir(), ".claude");
    this.db = new SessionDB(config.dbPath, config.logger);
  }

  // ===========================================================================
  // Managed instances (read-write, spawned by relay)
  // ===========================================================================

  createInstance(options?: {
    name?: string;
    workingDirectory?: string;
    dangerouslySkipPermissions?: boolean;
    resumeSessionId?: string;
  }): InstanceInfo {
    const managedCount = [...this.instances.values()].filter((i) => !i.info.external).length;
    if (managedCount >= this.baseConfig.maxProcesses) {
      throw new Error(`Maximum processes (${this.baseConfig.maxProcesses}) reached`);
    }

    const id = randomUUID();
    this.instanceCounter++;
    const workingDirectory = options?.workingDirectory || this.baseConfig.workingDirectory;
    const now = Date.now();
    const resumeId = options?.resumeSessionId;

    // Git worktree isolation — only for new instances (not resumes)
    let actualCwd = workingDirectory;
    let worktreePath: string | undefined;
    let gitBranch: string | undefined;
    let originalDirectory: string | undefined;

    if (!resumeId) {
      const repoRoot = getRepoRoot(workingDirectory);
      if (repoRoot) {
        const shortId = id.substring(0, 8);
        const result = createWorktree(repoRoot, shortId);
        if (result) {
          worktreePath = result.worktreePath;
          gitBranch = result.branchName;
          originalDirectory = workingDirectory;
          actualCwd = result.worktreePath;
          this.baseConfig.logger.info(
            `[InstanceManager] Created worktree at ${worktreePath} on branch ${gitBranch}`,
          );
        } else {
          this.baseConfig.logger.warn(
            `[InstanceManager] Failed to create worktree for ${workingDirectory}, using original directory`,
          );
        }
      }
    }

    const instanceConfig: CoreConfig = {
      ...this.baseConfig,
      workingDirectory: actualCwd,
      dangerouslySkipPermissions:
        options?.dangerouslySkipPermissions ?? this.baseConfig.dangerouslySkipPermissions,
    };

    const proc = resumeId
      ? new ClaudeProcess(instanceConfig, { resumeSessionId: resumeId })
      : new ClaudeProcess(instanceConfig);

    // Resolve name: explicit > session summary > auto-title from first message
    let name = options?.name || "";
    if (!name && resumeId) {
      name = this.getSessionSummary(resumeId, workingDirectory) || "";
    }
    if (!name) name = `Instance ${this.instanceCounter}`;

    const info: InstanceInfo = {
      id,
      name,
      workingDirectory,
      status: "idle",
      createdAt: now,
      lastActivityAt: now,
      gitBranch,
      originalDirectory,
      gitInfo: getGitInfo(workingDirectory) ?? undefined,
    };

    const dirBasename = workingDirectory.split("/").pop() || "";
    const hasCustomName = !!(options?.name && options.name !== dirBasename);
    const instance: Instance = {
      info,
      process: proc,
      history: [],
      autoTitle: !hasCustomName && !resumeId,
      worktreePath,
      gitBranch,
      originalDirectory,
      actualCwd: actualCwd !== workingDirectory ? actualCwd : undefined,
    };
    this.instances.set(id, instance);

    this.wireProcessEvents(id, instance, proc);

    if (resumeId) {
      // We already know the session ID — set it up directly instead of waiting for captureSessionId
      const encoded = workingDirectory.replace(/\//g, "-");
      const jsonlPath = join(this.claudeDir, "projects", encoded, `${resumeId}.jsonl`);
      instance.sessionId = resumeId;
      instance.jsonlPath = jsonlPath;
      info.sessionId = resumeId;
      proc.setSessionId(resumeId);

      // Parse existing history so the UI shows the full conversation
      if (existsSync(jsonlPath)) {
        const { history, tasks, files, team, stats } = this.parseJsonl(jsonlPath);
        instance.history = history;
        if (tasks.size > 0) instance.tasks = tasks;
        if (files.size > 0) instance.files = files;
        if (team) instance.team = team;
        if (stats.costUSD > 0) info.stats = stats;

        // Start JSONL watcher
        try {
          instance.watchState = createWatchState(jsonlPath, statSync(jsonlPath).size, info.stats);
          this.startWatching(id, instance);
        } catch {
          /* ignore */
        }
      }

      this.dbSave(instance);
    } else {
      this.captureSessionId(id, instance, proc);
    }

    this.baseConfig.logger.info(
      `[InstanceManager] Created instance "${name}" (${id})${resumeId ? ` resuming ${resumeId}` : ""}`,
    );
    return { ...info };
  }

  removeInstance(id: string): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;

    if (instance.process) {
      instance.process.kill();
    }

    // Stop JSONL watcher
    const watchInterval = this.watchIntervals.get(id);
    if (watchInterval) {
      clearInterval(watchInterval);
      this.watchIntervals.delete(id);
    }

    instance.info.status = "stopped";
    this.instances.delete(id);
    if (instance.sessionId) this.db.archive(instance.sessionId);

    // Clean up git worktree if this instance used one
    if (instance.worktreePath && instance.gitBranch && instance.originalDirectory) {
      const repoRoot = getRepoRoot(instance.originalDirectory);
      if (repoRoot) {
        try {
          removeWorktree(repoRoot, instance.worktreePath, instance.gitBranch);
          this.baseConfig.logger.info(
            `[InstanceManager] Removed worktree ${instance.worktreePath} and branch ${instance.gitBranch}`,
          );
        } catch (err) {
          this.baseConfig.logger.warn(`[InstanceManager] Failed to remove worktree: ${err}`);
        }
      }
    }

    this.baseConfig.logger.info(
      `[InstanceManager] Removed instance "${instance.info.name}" (${id})`,
    );
    return true;
  }

  listInstances(): InstanceInfo[] {
    return Array.from(this.instances.values()).map((i) => ({ ...i.info }));
  }

  getInstance(id: string): InstanceInfo | undefined {
    const instance = this.instances.get(id);
    return instance ? { ...instance.info } : undefined;
  }

  /**
   * Send a message to an instance. If the instance is external (read-only),
   * transparently resumes it first. Returns the updated InstanceInfo if a
   * resume happened (so callers can broadcast the transition), undefined otherwise.
   */
  sendMessage(id: string, text: string, images?: string[]): InstanceInfo | undefined {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`Instance ${id} not found`);

    // Transparent resume/revive on first send
    let resumed: InstanceInfo | undefined;
    if (instance.info.status === "stopped" && instance.sessionId) {
      resumed = this.reviveInstance(id);
    } else if (instance.info.external) {
      resumed = this.resumeInstance(id);
    }

    // Auto-title from first user message
    if (instance.autoTitle) {
      instance.info.name = generateTitle(text);
      instance.autoTitle = false;
    }

    // Build message text with image file paths so Claude can read them
    let messageText = text;
    if (images && images.length > 0) {
      const markers = images.map((p) => `[Image: source: ${p}]`).join("\n");
      messageText = messageText ? `${messageText}\n${markers}` : markers;
    }

    // Store user message in history so replay works across devices
    const userMessage: UserMessage = { type: "user", text: messageText, images, instanceId: id };
    this.pushHistory(instance, userMessage);

    // Immediately reflect processing status
    instance.info.lastActivityAt = Date.now();
    instance.info.pendingTool = undefined;
    instance.info.pendingPermission = undefined;
    this.setStatus(instance, "processing");

    instance.process!.send(messageText);
    return resumed;
  }

  cancelMessage(id: string): void {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`Instance ${id} not found`);
    if (instance.info.external) throw new Error("Cannot cancel on external instances");
    instance.process!.cancel();
  }

  /**
   * Approve a previously denied tool and retry. Adds the tool to the process's
   * allowed list, stores a user message, and sends a retry prompt.
   */
  approveToolUse(id: string, tool: string): void {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`Instance ${id} not found`);
    if (instance.info.external) throw new Error("Cannot approve tools on external instances");

    // Group file-write tools: approving any one approves all three
    const isFileWrite = FILE_WRITE_GROUP.includes(tool);
    const toolsToAdd = isFileWrite ? FILE_WRITE_GROUP : [tool];
    for (const t of toolsToAdd) {
      instance.process!.addAllowedTool(t);
    }

    // Contextual retry message
    const toolLabel = isFileWrite ? "file writes" : tool;
    const retryText = `Permission granted for ${toolLabel}. Please continue.`;
    instance.info.pendingTool = undefined;
    instance.info.pendingPermission = undefined;

    // Persist allowed tools to DB so they survive restarts
    if (instance.sessionId) {
      try {
        // Collect all currently allowed tools from the process
        const allTools = [...new Set([...toolsToAdd])];
        // Merge with any tools already in DB
        const row = this.db.getBySessionId(instance.sessionId);
        if (row) {
          try {
            const existing = JSON.parse(row.allowed_tools) as string[];
            for (const t of existing) {
              if (!allTools.includes(t)) allTools.push(t);
            }
          } catch {
            // ignore parse errors
          }
        }
        this.db.updateAllowedTools(instance.sessionId, allTools);
      } catch (err) {
        this.baseConfig.logger.warn(`[InstanceManager] Failed to persist allowed tools: ${err}`);
      }
    }

    if (instance.process!.isProcessing) {
      // Process is still running (finishing its "I need permission..." response).
      // Queue the retry — it will be drained when the process becomes idle.
      instance.pendingRetry = retryText;
    } else {
      const userMessage: UserMessage = { type: "user", text: retryText, instanceId: id };
      this.pushHistory(instance, userMessage);
      instance.info.lastActivityAt = Date.now();
      this.setStatus(instance, "processing");
      instance.process!.send(retryText);
    }
  }

  /**
   * Resume an external session — converts it from read-only monitoring
   * to an interactive managed instance using `claude -p --resume <sessionId>`.
   */
  resumeInstance(id: string): InstanceInfo {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`Instance ${id} not found`);
    if (!instance.externalState) throw new Error("Instance is not an external session");

    const sessionId = instance.externalState.sessionId;
    const jsonlPath = instance.externalState.jsonlPath;
    const cwd = instance.actualCwd || instance.info.workingDirectory;

    // JSONL watcher keeps running — watchState is independent of externalState.
    // The watcher suppresses emissions while the process is active (dedup),
    // and picks up terminal-side changes when the process is idle.

    // Create a ClaudeProcess that resumes the session — do this BEFORE
    // mutating instance state so a failure leaves the instance unchanged.
    const instanceConfig: CoreConfig = {
      ...this.baseConfig,
      workingDirectory: cwd,
    };

    let proc: ClaudeProcess;
    try {
      proc = new ClaudeProcess(instanceConfig, { resumeSessionId: sessionId });
    } catch (err) {
      this.baseConfig.logger.error(`[InstanceManager] Failed to create process for resume: ${err}`);
      throw err;
    }

    // Preserve session info so discovery doesn't re-create this instance
    instance.sessionId = sessionId;
    instance.jsonlPath = jsonlPath;
    instance.info.sessionId = sessionId;

    // Convert from external to managed — save previous state for rollback
    const prevExternal = instance.info.external;
    const prevExternalState = instance.externalState;
    const prevProcess = instance.process;

    instance.process = proc;
    instance.info.external = false;
    delete instance.externalState;

    try {
      this.wireProcessEvents(id, instance, proc);
      this.captureSessionId(id, instance, proc);
    } catch (err) {
      // Rollback: restore previous external state so discovery doesn't duplicate
      instance.process = prevProcess;
      instance.info.external = prevExternal;
      instance.externalState = prevExternalState;
      proc.kill();
      this.baseConfig.logger.error(
        `[InstanceManager] Failed to wire resumed session, rolled back: ${err}`,
      );
      throw err;
    }

    this.setStatus(instance, "idle");
    this.dbSave(instance);
    this.baseConfig.logger.info(
      `[InstanceManager] Resumed session "${instance.info.name}" (claude session: ${sessionId})`,
    );

    return { ...instance.info };
  }

  /**
   * Revive a stopped session — creates a new ClaudeProcess with --resume
   * so the user can continue a previously ended conversation.
   */
  reviveInstance(id: string): InstanceInfo {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`Instance ${id} not found`);
    if (instance.info.status !== "stopped") throw new Error("Instance is not stopped");
    if (!instance.sessionId) throw new Error("Instance has no session to revive");

    const sessionId = instance.sessionId;
    const cwd = instance.actualCwd || instance.info.workingDirectory;

    const instanceConfig: CoreConfig = {
      ...this.baseConfig,
      workingDirectory: cwd,
    };

    let proc: ClaudeProcess;
    try {
      proc = new ClaudeProcess(instanceConfig, { resumeSessionId: sessionId });
    } catch (err) {
      this.baseConfig.logger.error(`[InstanceManager] Failed to create process for revive: ${err}`);
      throw err;
    }

    const prevProcess = instance.process;
    instance.process = proc;

    try {
      this.wireProcessEvents(id, instance, proc);
    } catch (err) {
      instance.process = prevProcess;
      proc.kill();
      this.baseConfig.logger.error(
        `[InstanceManager] Failed to wire revived session, rolled back: ${err}`,
      );
      throw err;
    }

    this.setStatus(instance, "idle");
    this.dbSave(instance);
    this.baseConfig.logger.info(
      `[InstanceManager] Revived session "${instance.info.name}" (claude session: ${sessionId})`,
    );

    return { ...instance.info };
  }

  getHistory(id: string): HistoryEntry[] {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`Instance ${id} not found`);
    return [...instance.history];
  }

  /**
   * Return directories where Claude has been used, sorted by most recent activity.
   * Scans ~/.claude/projects/ and decodes the encoded directory names.
   */
  getKnownDirectories(): { path: string; lastUsed: number }[] {
    const projectsDir = join(this.claudeDir, "projects");
    if (!existsSync(projectsDir)) return [];

    try {
      return readdirSync(projectsDir)
        .filter((name) => {
          // Encoded dirs start with a dash (encoded leading /)
          if (!name.startsWith("-")) return false;
          try {
            return statSync(join(projectsDir, name)).isDirectory();
          } catch {
            return false;
          }
        })
        .map((name) => {
          const projectDir = join(projectsDir, name);
          let lastUsed = 0;
          let resolvedPath = decodeProjectDir(name);

          try {
            const jsonlFiles = readdirSync(projectDir)
              .filter((f) => f.endsWith(".jsonl"))
              .map((f) => {
                const fullPath = join(projectDir, f);
                try {
                  return { path: fullPath, mtime: statSync(fullPath).mtimeMs };
                } catch {
                  return null;
                }
              })
              .filter((f): f is { path: string; mtime: number } => f !== null);

            if (jsonlFiles.length > 0) {
              lastUsed = Math.max(...jsonlFiles.map((f) => f.mtime));

              // Read the cwd from the most recent JSONL for accurate path
              jsonlFiles.sort((a, b) => b.mtime - a.mtime);
              const cwdFromJsonl = readCwdFromJsonl(jsonlFiles[0].path);
              if (cwdFromJsonl && existsSync(cwdFromJsonl)) {
                resolvedPath = cwdFromJsonl;
              }
            }
          } catch {
            // ignore
          }
          return { path: resolvedPath, lastUsed };
        })
        .filter((d) => existsSync(d.path)) // only include dirs that still exist
        .sort((a, b) => b.lastUsed - a.lastUsed);
    } catch {
      return [];
    }
  }

  /**
   * Aggregate project artifacts (memory, plans, sessions, tasks) for a given
   * project ID (the encoded directory name under ~/.claude/projects/).
   */
  /**
   * Resolve a project slug to the full encoded directory name under ~/.claude/projects/.
   * Accepts either:
   *   - Full encoded path (e.g., "-Users-erichermanson-projects-claude-relay") — exact match
   *   - Basename slug (e.g., "claude-relay") — scans for dirs ending with "-{slug}"
   * Returns the directory name or null if not found.
   */
  resolveProjectId(slug: string): string | null {
    const projectsDir = join(this.claudeDir, "projects");

    // Exact match first
    const exact = join(projectsDir, slug);
    try {
      if (statSync(exact).isDirectory()) return slug;
    } catch {
      /* not found */
    }

    // Scan for directories ending with "-{slug}"
    const suffix = `-${slug}`;
    try {
      const dirs = readdirSync(projectsDir).filter((d) => {
        if (!d.endsWith(suffix)) return false;
        try {
          return statSync(join(projectsDir, d)).isDirectory();
        } catch {
          return false;
        }
      });
      if (dirs.length === 1) return dirs[0];
      if (dirs.length > 1) {
        // Multiple matches — pick most recently modified (by newest JSONL mtime)
        let best = dirs[0];
        let bestMtime = 0;
        for (const d of dirs) {
          try {
            const files = readdirSync(join(projectsDir, d)).filter((f) => f.endsWith(".jsonl"));
            for (const f of files) {
              try {
                const mt = statSync(join(projectsDir, d, f)).mtimeMs;
                if (mt > bestMtime) {
                  bestMtime = mt;
                  best = d;
                }
              } catch {
                /* skip */
              }
            }
          } catch {
            /* skip */
          }
        }
        return best;
      }
    } catch {
      /* ignore */
    }

    return null;
  }

  getProjectArtifacts(projectId: string): ProjectArtifacts | null {
    const resolvedId = this.resolveProjectId(projectId);
    if (!resolvedId) return null;

    const projectDir = join(this.claudeDir, "projects", resolvedId);

    // Resolve real path — JSONL cwd is authoritative, with instance-based fallback.
    let directory = "";
    try {
      const jsonlFiles = readdirSync(projectDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => {
          const fullPath = join(projectDir, f);
          try {
            return { path: fullPath, mtime: statSync(fullPath).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((f): f is { path: string; mtime: number } => f !== null);

      if (jsonlFiles.length > 0) {
        jsonlFiles.sort((a, b) => b.mtime - a.mtime);
        try {
          const head = readFileSync(jsonlFiles[0].path, "utf-8").split("\n")[0];
          const parsed = JSON.parse(head);
          if (parsed.cwd) directory = parsed.cwd;
        } catch {
          /* fall back below */
        }
      }
    } catch {
      /* ignore */
    }

    // Fallback: check active instances whose encoded workingDirectory matches
    if (!directory) {
      for (const instance of this.instances.values()) {
        if (instance.info.workingDirectory.replace(/\//g, "-") === resolvedId) {
          directory = instance.info.workingDirectory;
          break;
        }
      }
    }

    // Last resort: filesystem-validated decode
    if (!directory) {
      directory = decodeProjectDir(resolvedId);
    }

    // Memory
    let memory: string | null = null;
    const memoryPath = join(projectDir, "memory", "MEMORY.md");
    try {
      memory = readFileSync(memoryPath, "utf-8");
    } catch {
      /* no memory file */
    }

    // CLAUDE.md from project root
    let claudeMd: string | null = null;
    if (directory) {
      try {
        claudeMd = readFileSync(join(directory, "CLAUDE.md"), "utf-8");
      } catch {
        /* no CLAUDE.md */
      }
    }

    // README.md from project root (last-resort fallback)
    let readmeMd: string | null = null;
    if (directory) {
      try {
        readmeMd = readFileSync(join(directory, "README.md"), "utf-8");
      } catch {
        /* no README.md */
      }
    }

    // Plans — collect slugs from JSONL files, then check ~/.claude/plans/
    const plans: ProjectPlan[] = [];
    const seenSlugs = new Set<string>();
    try {
      const jsonlFiles = readdirSync(projectDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => join(projectDir, f));

      for (const jsonlPath of jsonlFiles) {
        const slug = this.extractSlugFromJsonl(jsonlPath);
        if (slug && !seenSlugs.has(slug)) {
          seenSlugs.add(slug);
          const planPath = join(this.claudeDir, "plans", `${slug}.md`);
          try {
            const content = readFileSync(planPath, "utf-8");
            // Use the JSONL session mtime (when the plan was last used) rather than
            // the plan file mtime (when the plan was written — often a one-time event)
            let mtime: number;
            try {
              mtime = statSync(jsonlPath).mtimeMs;
            } catch {
              mtime = statSync(planPath).mtimeMs;
            }
            let title = slug;
            for (const line of content.split("\n")) {
              if (line.startsWith("# ")) {
                title = line.slice(2).trim();
                break;
              }
            }
            plans.push({ slug, title, modifiedAt: mtime, content });
          } catch {
            /* plan file missing */
          }
        }
      }
      plans.sort((a, b) => a.modifiedAt - b.modifiedAt);
    } catch {
      /* ignore */
    }

    return { projectId: resolvedId, directory, memory, claudeMd, readmeMd, plans };
  }

  private extractSlugFromJsonl(filePath: string): string | null {
    let fd: number;
    try {
      fd = openSync(filePath, "r");
    } catch {
      return null;
    }
    try {
      const buf = Buffer.alloc(32768);
      const bytesRead = readSync(fd, buf, 0, 32768, 0);
      const head = buf.toString("utf-8", 0, bytesRead);
      for (const line of head.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.slug) return entry.slug;
        } catch {
          /* partial line at end of buffer */
        }
      }
    } finally {
      closeSync(fd);
    }
    return null;
  }

  get defaultWorkingDirectory(): string {
    return this.baseConfig.workingDirectory;
  }

  stopAll(): void {
    for (const instance of this.instances.values()) {
      if (instance.process) {
        instance.process.kill();
      }
      instance.info.status = "stopped";
      if (instance.sessionId) {
        this.db.updateLastActivity(instance.sessionId, instance.info.lastActivityAt);
      }
    }
    this.instances.clear();
    this.stopDiscovery();
    this.db.close();
  }

  // ===========================================================================
  // External session discovery
  // ===========================================================================

  startDiscovery(): void {
    this.discoverExisting();
    this.discoveryInterval = setInterval(() => this.discoverExisting(), DISCOVERY_INTERVAL);
    this.baseConfig.logger.info("[InstanceManager] Session discovery started");
  }

  stopDiscovery(): void {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }
    for (const interval of this.watchIntervals.values()) {
      clearInterval(interval);
    }
    this.watchIntervals.clear();
  }

  private discoverExisting(): void {
    const projectsDir = join(this.claudeDir, "projects");
    if (!existsSync(projectsDir)) return;

    // Collect PIDs of managed instances' active processes so discovery skips them
    const managedPids = new Set<number>();
    for (const [, instance] of this.instances) {
      const pid = instance.process?.pid;
      if (pid !== undefined) managedPids.add(pid);
    }

    // Find running claude processes — returns cwds with counts (multiple PIDs per cwd)
    const cwdCounts = this.findRunningClaudeCwds(managedPids);
    if (cwdCounts.size === 0) {
      this.removeStaleExternals(new Set());
      return;
    }

    // For each cwd, find N most recently modified JSONLs (N = number of PIDs in that cwd)
    const activeJsonls = new Map<string, string>(); // jsonlPath → cwd
    for (const [cwd, count] of cwdCounts) {
      const projectDir = this.cwdToProjectDir(cwd, projectsDir);
      if (!projectDir || !existsSync(projectDir)) continue;

      const jsonlPaths = this.findRecentJsonls(projectDir, count);
      for (const p of jsonlPaths) {
        activeJsonls.set(p, cwd);
      }
    }

    // Track known JSONL paths (external + managed)
    const knownJsonls = new Map<string, string>(); // jsonlPath → instanceId
    for (const [instanceId, instance] of this.instances) {
      if (instance.externalState) {
        knownJsonls.set(instance.externalState.jsonlPath, instanceId);
      }
      if (instance.jsonlPath) {
        knownJsonls.set(instance.jsonlPath, instanceId);
      }
    }

    // Remove external instances that are no longer active
    this.removeStaleExternals(new Set(activeJsonls.keys()));

    // Discover new sessions (and upgrade restored stopped externals)
    for (const [jsonlPath, cwd] of activeJsonls) {
      if (knownJsonls.has(jsonlPath)) {
        // Check if this is a restored stopped external that should be upgraded to active
        const existingId = knownJsonls.get(jsonlPath)!;
        const existing = this.instances.get(existingId);
        if (
          existing &&
          existing.info.external &&
          existing.info.status === "stopped" &&
          !existing.externalState
        ) {
          this.upgradeRestoredExternal(existingId, existing, jsonlPath);
        }
        continue;
      }

      const fileName = jsonlPath.split("/").pop() || "";
      const sessionId = fileName.replace(".jsonl", "");

      try {
        // Auto-unarchive: if this session is archived in DB, restore it
        const archivedRow = this.db.getByJsonlPath(jsonlPath);
        if (archivedRow?.archived) {
          this.db.unarchive(archivedRow.session_id);
        }

        // Check for plan-continuation (explicit parent reference in first message)
        const planParent = this.findPlanParent(jsonlPath);
        if (planParent && !planParent.process) {
          this.stitchSession(planParent, sessionId, jsonlPath);
        } else {
          // Fall back to temporal stitch (same CWD + stopped + within 60s)
          const stitchTarget = this.findStitchTarget(cwd, jsonlPath);
          if (stitchTarget) {
            this.stitchSession(stitchTarget, sessionId, jsonlPath);
          } else {
            this.addExternalInstance(sessionId, jsonlPath);
          }
        }
      } catch (err) {
        this.baseConfig.logger.debug(`[InstanceManager] Failed to add external session: ${err}`);
      }
    }
  }

  /** Returns a map of cwd → number of external claude PIDs running in that directory */
  private findRunningClaudeCwds(excludePids: Set<number>): Map<string, number> {
    const cwdCounts = new Map<string, number>();
    try {
      const psOutput = execSync("ps -eo pid,comm 2>/dev/null | grep -E '\\bclaude$' || true", {
        encoding: "utf-8",
        timeout: 5000,
      });

      const pids: number[] = [];
      for (const line of psOutput.split("\n")) {
        const match = line.trim().match(/^(\d+)\s/);
        if (match) {
          const pid = parseInt(match[1]);
          if (!excludePids.has(pid)) pids.push(pid);
        }
      }

      for (const pid of pids) {
        try {
          const lsofOutput = execSync(`lsof -p ${pid} -a -d cwd -Fn 2>/dev/null || true`, {
            encoding: "utf-8",
            timeout: 5000,
          });
          for (const line of lsofOutput.split("\n")) {
            if (line.startsWith("n/")) {
              const cwd = line.substring(1);
              cwdCounts.set(cwd, (cwdCounts.get(cwd) || 0) + 1);
            }
          }
        } catch {
          // skip
        }
      }
    } catch {
      // ignore
    }
    return cwdCounts;
  }

  private cwdToProjectDir(cwd: string, projectsDir: string): string | null {
    const encoded = cwd.replace(/\//g, "-");
    const projectDir = join(projectsDir, encoded);
    return existsSync(projectDir) ? projectDir : null;
  }

  /** Return the N most recently modified JSONL files in a project dir */
  private findRecentJsonls(projectDir: string, count: number): string[] {
    try {
      const files = readdirSync(projectDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => {
          const fullPath = join(projectDir, f);
          try {
            return { path: fullPath, mtime: statSync(fullPath).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((f): f is { path: string; mtime: number } => f !== null);

      files.sort((a, b) => b.mtime - a.mtime);
      return files.slice(0, count).map((f) => f.path);
    } catch {
      return [];
    }
  }

  private removeStaleExternals(activeJsonlPaths: Set<string>): void {
    for (const [instanceId, instance] of this.instances) {
      if (instance.externalState && !activeJsonlPaths.has(instance.externalState.jsonlPath)) {
        // Preserve jsonlPath for dedup so discovery doesn't re-add this session
        instance.jsonlPath = instance.externalState.jsonlPath;
        instance.sessionId = instance.sessionId || instance.externalState.sessionId;
        delete instance.externalState;

        // Stop the JSONL watcher — session is no longer active
        const watchInterval = this.watchIntervals.get(instanceId);
        if (watchInterval) {
          clearInterval(watchInterval);
          this.watchIntervals.delete(instanceId);
        }

        this.setStatus(instance, "stopped");
        // Update DB with last activity timestamp
        if (instance.sessionId) {
          this.db.updateLastActivity(instance.sessionId, instance.info.lastActivityAt);
        }
        this.baseConfig.logger.info(
          `[InstanceManager] External session ended: "${instance.info.name}"`,
        );
      }
    }
  }

  /**
   * Upgrade a restored stopped external session to active — called when
   * discovery finds a running claude process with a JSONL that matches
   * a stopped instance from the manifest.
   */
  private upgradeRestoredExternal(instanceId: string, instance: Instance, jsonlPath: string): void {
    const sessionId = instance.sessionId || jsonlPath.split("/").pop()?.replace(".jsonl", "") || "";

    let fileSize: number;
    try {
      fileSize = statSync(jsonlPath).size;
    } catch {
      return;
    }

    instance.externalState = {
      jsonlPath,
      sessionId,
    };

    instance.watchState = createWatchState(jsonlPath, fileSize, instance.info.stats);

    this.startWatching(instanceId, instance);
    this.setStatus(instance, "idle");
    this.dbSave(instance);

    this.baseConfig.logger.info(
      `[InstanceManager] Upgraded restored session "${instance.info.name}" to active`,
    );
  }

  private addExternalInstance(sessionId: string, jsonlPath: string): void {
    const { cwd, history, tasks, files, team, stats } = this.parseJsonl(jsonlPath);
    if (!cwd) return; // Can't determine working directory

    const id = randomUUID();
    const dirName = cwd.split("/").pop() || "unknown";
    const name = this.resolveSessionTitle(sessionId, cwd, history) || dirName;
    const now = Date.now();
    const lastActivity = history.length > 0 ? history[history.length - 1].timestamp : now;

    const lastMessage = extractLastMessage(history);

    const info: InstanceInfo = {
      id,
      name,
      workingDirectory: cwd,
      status: "idle",
      createdAt: lastActivity,
      lastActivityAt: lastActivity,
      external: true,
      lastMessage,
      sessionId,
      stats: stats.costUSD > 0 ? stats : undefined,
      gitInfo: getGitInfo(cwd) ?? undefined,
    };

    let fileSize: number;
    try {
      fileSize = statSync(jsonlPath).size;
    } catch {
      return;
    }

    const instance: Instance = {
      info,
      process: null,
      history,
      sessionId,
      jsonlPath,
      externalState: {
        jsonlPath,
        sessionId,
      },
      watchState: createWatchState(jsonlPath, fileSize, info.stats),
      tasks: tasks.size > 0 ? tasks : undefined,
      files: files.size > 0 ? files : undefined,
      team: team ?? undefined,
    };

    this.instances.set(id, instance);
    this.startWatching(id, instance);
    this.emit("instance:created", id, { ...info });
    this.dbSave(instance);

    this.baseConfig.logger.info(
      `[InstanceManager] Discovered external session "${name}" in ${cwd}`,
    );
  }

  /**
   * Find an existing stopped instance that a new session should be stitched onto.
   * Matches on same CWD, stopped status, and temporal proximity.
   */
  private findStitchTarget(cwd: string, newJsonlPath: string): Instance | null {
    // Get the first entry timestamp from the new JSONL (partial read — only need the first entry)
    let newSessionStart: number | null = null;
    let fd: number;
    try {
      fd = openSync(newJsonlPath, "r");
    } catch {
      return null;
    }
    try {
      const buf = Buffer.alloc(32768);
      const bytesRead = readSync(fd, buf, 0, 32768, 0);
      const head = buf.toString("utf-8", 0, bytesRead);
      for (const line of head.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry.timestamp) {
            const parsed = new Date(entry.timestamp).getTime();
            if (!isNaN(parsed)) {
              newSessionStart = parsed;
              break;
            }
          }
        } catch {
          // skip — possibly truncated line at end of buffer
        }
      }

      // Fallback: use file mtime if no valid timestamp found in entries
      if (newSessionStart === null) {
        newSessionStart = statSync(newJsonlPath).mtimeMs;
      }
    } catch {
      closeSync(fd);
      return null;
    }
    closeSync(fd);
    if (!newSessionStart) return null;

    let bestMatch: Instance | null = null;
    let smallestGap = Infinity;

    for (const instance of this.instances.values()) {
      if (instance.info.workingDirectory !== cwd) continue;
      if (instance.info.status !== "stopped") continue;

      const gap = Math.abs(newSessionStart - instance.info.lastActivityAt);
      if (gap <= STITCH_WINDOW_MS && gap < smallestGap) {
        smallestGap = gap;
        bestMatch = instance;
      }
    }

    return bestMatch;
  }

  /**
   * Detect plan-continuation sessions: when Claude Code exits plan mode,
   * the user approves, and a new session is created to implement the plan.
   * The new session's first user message contains an explicit reference:
   *   "read the full transcript at: /path/to/<parent-session-id>.jsonl"
   * Returns the parent instance if found, null otherwise.
   */
  private findPlanParent(jsonlPath: string): Instance | null {
    try {
      // Read up to 32KB — enough to find the first user message even with
      // system events and metadata preceding it.
      const MAX_SCAN_BYTES = 32 * 1024;
      const fd = openSync(jsonlPath, "r");
      let content: string;
      try {
        const fileSize = statSync(jsonlPath).size;
        const readSize = Math.min(fileSize, MAX_SCAN_BYTES);
        const buf = Buffer.alloc(readSize);
        readSync(fd, buf, 0, readSize, 0);
        content = buf.toString("utf-8");
      } finally {
        closeSync(fd);
      }
      const lines = content.split("\n");

      // Scan until first user message is found (no arbitrary line limit).
      // The byte limit above provides the safety cap.
      for (const line of lines) {
        if (!line.trim()) continue;

        let entry: {
          type?: string;
          message?: { content?: string | Array<{ type: string; text?: string }> };
        };
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }

        if (entry.type !== "user" || !entry.message?.content) continue;

        // Extract text from content (string or array-of-blocks)
        let text = "";
        const content = entry.message.content;
        if (typeof content === "string") {
          text = content;
        } else if (Array.isArray(content)) {
          text = content
            .filter((b) => b.type === "text" && b.text)
            .map((b) => b.text!)
            .join("\n");
        }

        const match = text.match(PLAN_TRANSCRIPT_RE);
        if (!match) continue;

        const parentJsonlPath = match[1];

        // Look up parent instance by JSONL path
        for (const instance of this.instances.values()) {
          if (
            instance.jsonlPath === parentJsonlPath ||
            instance.externalState?.jsonlPath === parentJsonlPath
          ) {
            this.baseConfig.logger.info(
              `[InstanceManager] Plan-continuation detected: "${instance.info.name}" → ${jsonlPath.split("/").pop()}`,
            );
            return instance;
          }
        }

        // Parent JSONL path found in message but no matching instance
        return null;
      }
    } catch {
      // File read error — fall through
    }

    return null;
  }

  /**
   * Stitch a new session onto an existing instance — used when /clear
   * creates a new JSONL file but the user considers it the same workflow.
   */
  private stitchSession(instance: Instance, sessionId: string, jsonlPath: string): void {
    const { history: newHistory, tasks, files, team, stats } = this.parseJsonl(jsonlPath);

    // Accumulate stats from stitched session
    if (stats.costUSD > 0) {
      if (instance.info.stats) {
        instance.info.stats.inputTokens += stats.inputTokens;
        instance.info.stats.outputTokens += stats.outputTokens;
        instance.info.stats.cacheCreationTokens += stats.cacheCreationTokens;
        instance.info.stats.cacheReadTokens += stats.cacheReadTokens;
        instance.info.stats.costUSD += stats.costUSD;
      } else {
        instance.info.stats = stats;
      }
    }

    // Add a separator so the UI shows the session boundary
    instance.history.push({
      timestamp: Date.now(),
      message: {
        type: "output",
        text: "--- Session continued ---",
        isWaiting: false,
      } as OutputMessage,
    });

    // Append new history
    for (const entry of newHistory) {
      instance.history.push(entry);
    }

    // Trim to MAX_HISTORY
    if (instance.history.length > MAX_HISTORY) {
      instance.history.splice(0, instance.history.length - MAX_HISTORY);
    }

    // Stop old watcher
    const oldInterval = this.watchIntervals.get(instance.info.id);
    if (oldInterval) {
      clearInterval(oldInterval);
      this.watchIntervals.delete(instance.info.id);
    }

    // Update instance state to point to new session
    const oldSessionId = instance.sessionId;
    instance.sessionId = sessionId;
    instance.jsonlPath = jsonlPath;
    instance.info.sessionId = sessionId;

    let fileSize: number;
    try {
      fileSize = statSync(jsonlPath).size;
    } catch {
      fileSize = 0;
    }

    // Only set externalState for external instances — managed instances
    // should never be flipped to external by stitching.
    if (instance.info.external) {
      instance.externalState = {
        jsonlPath,
        sessionId,
      };
    }

    instance.watchState = createWatchState(jsonlPath, fileSize, instance.info.stats);

    if (tasks.size > 0) instance.tasks = tasks;
    if (files.size > 0) instance.files = files;
    if (team) instance.team = team;

    // Update activity and status
    const lastEntry = newHistory[newHistory.length - 1];
    if (lastEntry) {
      instance.info.lastActivityAt = lastEntry.timestamp;
      const msg = lastEntry.message;
      if (msg.type === "user" && (msg as UserMessage).text) {
        instance.info.lastMessage = {
          text: (msg as UserMessage).text,
          from: "user",
          timestamp: lastEntry.timestamp,
        };
      } else if (msg.type === "output") {
        const output = msg as OutputMessage;
        if (output.text && output.text.trim() && !output.isWaiting) {
          instance.info.lastMessage = {
            text: output.text,
            from: "claude",
            timestamp: lastEntry.timestamp,
          };
        }
      }
    }

    this.setStatus(instance, instance.info.external ? "idle" : instance.info.status);
    this.startWatching(instance.info.id, instance);

    // Update DB: remove old session entry, upsert new one
    if (oldSessionId && oldSessionId !== sessionId) {
      this.db.deleteBySessionId(oldSessionId);
    }
    this.dbSave(instance);

    // Broadcast the update
    this.emit("instance:status", instance.info.id, { ...instance.info });

    this.baseConfig.logger.info(
      `[InstanceManager] Stitched session "${instance.info.name}" to new session ${sessionId}`,
    );
  }

  // ===========================================================================
  // JSONL parsing
  // ===========================================================================

  private parseJsonl(filePath: string): {
    cwd: string;
    history: HistoryEntry[];
    tasks: Map<string, TaskItem>;
    files: Map<string, FileChange>;
    team: TeamInfo | null;
    stats: SessionStats;
  } {
    let cwd = "";
    const history: HistoryEntry[] = [];
    const zeroStats: SessionStats = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      costUSD: 0,
    };

    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      return {
        cwd,
        history,
        tasks: new Map(),
        files: new Map(),
        team: null,
        stats: zeroStats,
      };
    }

    const ctx = {
      pendingTools: new Map<string, string>(),
      pendingTaskCreates: new Map<string, { subject: string; activeForm?: string }>(),
      tasks: new Map<string, TaskItem>(),
      files: new Map<string, FileChange>(),
      team: null as TeamInfo | null,
      stats: { ...zeroStats },
    };
    let lastCompactBoundaryIndex = -1;

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (!cwd && entry.cwd) cwd = entry.cwd;

        // Track compact boundaries — we'll discard everything before the last one
        if (entry.type === "system" && entry.subtype === "compact_boundary") {
          lastCompactBoundaryIndex = history.length;
          continue;
        }

        const converted = this.convertJsonlEntry(entry, ctx);
        for (const h of converted) {
          history.push(h);
        }
      } catch {
        // skip malformed lines
      }
    }

    // Discard pre-compact history — it's been summarized and is redundant
    if (lastCompactBoundaryIndex > 0) {
      history.splice(0, lastCompactBoundaryIndex);
    }

    // Trim to MAX_HISTORY as a safety net
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }

    return {
      cwd,
      history,
      tasks: ctx.tasks,
      files: ctx.files,
      team: ctx.team,
      stats: ctx.stats,
    };
  }

  /**
   * Handle a tool_result content block from JSONL replay.
   * Shared between user-message and assistant-message tool_result handling.
   */
  private handleToolResultBlock(
    block: { tool_use_id?: string; is_error?: boolean; content?: string },
    timestamp: number,
    ctx: {
      pendingTools?: Map<string, string>;
      pendingTaskCreates?: Map<string, { subject: string; activeForm?: string }>;
      tasks?: Map<string, TaskItem>;
    },
    results: HistoryEntry[],
  ): void {
    const toolName = ctx.pendingTools?.get(block.tool_use_id || "");
    const isTaskTool = TASK_TOOLS.has(toolName || "");
    const blockContent = extractToolResultText(block.content);

    if (isTaskTool) {
      if (toolName === "TaskCreate") {
        const idMatch = blockContent.match(/Task #(\d+)/);
        const pending = ctx.pendingTaskCreates?.get(block.tool_use_id || "");
        if (idMatch && pending && ctx.tasks) {
          const taskId = idMatch[1];
          ctx.tasks.set(taskId, {
            id: taskId,
            subject: pending.subject,
            status: "pending",
            activeForm: pending.activeForm,
          });
          ctx.pendingTaskCreates?.delete(block.tool_use_id || "");
          results.push({
            timestamp,
            message: {
              type: "activity",
              activity: "task_list",
              description: "Tasks",
              tasks: Array.from(ctx.tasks.values()).map((t) => ({ ...t })),
            } as ActivityMessage,
          });
        }
      }
      // Other task tool results — skip
    } else {
      const denied = block.is_error && isPermissionDenial(blockContent);
      const deniedTool = denied
        ? ctx.pendingTools?.get(block.tool_use_id || "") || "Unknown"
        : undefined;
      results.push({
        timestamp,
        message: {
          type: "activity",
          activity: "tool_result",
          description: deniedTool
            ? "Permission denied"
            : block.is_error
              ? "Tool error"
              : "Tool completed",
          tool: deniedTool,
          detail: blockContent.slice(0, 200) || undefined,
          permissionDenied: deniedTool,
        } as ActivityMessage,
      });
    }
  }

  private convertJsonlEntry(
    entry: {
      type?: string;
      timestamp?: string;
      message?: {
        role?: string;
        model?: string;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_creation_input_tokens?: number;
          cache_read_input_tokens?: number;
        };
        content?:
          | string
          | Array<{
              type: string;
              text?: string;
              thinking?: string;
              name?: string;
              id?: string;
              input?: Record<string, unknown>;
              is_error?: boolean;
              content?: string;
              tool_use_id?: string;
            }>;
      };
    },
    ctx?: {
      pendingTools?: Map<string, string>;
      pendingTaskCreates?: Map<string, { subject: string; activeForm?: string }>;
      tasks?: Map<string, TaskItem>;
      files?: Map<string, FileChange>;
      team?: TeamInfo | null;
      stats?: SessionStats;
    },
  ): HistoryEntry[] {
    const pendingTools = ctx?.pendingTools;
    const results: HistoryEntry[] = [];
    const rawTimestamp = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();
    const timestamp = isNaN(rawTimestamp) ? Date.now() : rawTimestamp;

    if (entry.type === "user" && entry.message?.content) {
      const content = entry.message.content;
      let text = "";
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        const parts: string[] = [];
        for (const c of content) {
          if (c.type === "text" && c.text) {
            parts.push(c.text);
          } else if (c.type === "image") {
            const source = (c as Record<string, unknown>).source as
              | { type?: string; file_path?: string; url?: string; data?: string }
              | undefined;
            if (source?.file_path) {
              parts.push(`[Image: source: ${source.file_path}]`);
            } else if (source?.url) {
              parts.push(`[Image: source: ${source.url}]`);
            }
            // Skip base64 data images — too large for history
          } else if (c.type === "tool_result" && ctx) {
            // In Claude API format, tool_result blocks are in user messages.
            // Convert them to activity entries so the UI can show tool outcomes.
            this.handleToolResultBlock(c, timestamp, ctx, results);
          }
        }
        text = parts.join("\n");
      }
      // Strip internal CLI tags; skip if nothing meaningful remains
      text = stripInternalTags(text);
      if (text && !text.startsWith("[Request interrupted")) {
        results.push({
          timestamp,
          message: { type: "user", text } as UserMessage,
        });
      }
    } else if (entry.type === "assistant" && entry.message?.content) {
      const content = entry.message.content;
      if (Array.isArray(content)) {
        let textParts: string[] = [];

        for (const block of content) {
          if (block.type === "thinking" && block.thinking) {
            results.push({
              timestamp,
              message: {
                type: "activity",
                activity: "thinking",
                description: "Reasoning...",
                detail: block.thinking.slice(0, 500) + (block.thinking.length > 500 ? "..." : ""),
              } as ActivityMessage,
            });
          } else if (block.type === "tool_use") {
            // Flush accumulated text first
            const flushed = stripInternalTags(textParts.join(""));
            if (flushed) {
              results.push({
                timestamp,
                message: {
                  type: "output",
                  text: flushed,
                  isWaiting: false,
                } as OutputMessage,
              });
            }
            textParts = [];
            if (block.id && block.name && pendingTools) {
              pendingTools.set(block.id, block.name);
            }

            const isTaskTool = TASK_TOOLS.has(block.name || "");
            if (isTaskTool && ctx) {
              // Handle task tools — emit consolidated task_list instead of individual activities
              const input = block.input as Record<string, unknown> | undefined;
              if (block.name === "TodoWrite" && input && ctx.tasks) {
                const todos = input.todos as
                  | Array<{ content?: string; status?: string; activeForm?: string }>
                  | undefined;
                if (Array.isArray(todos)) {
                  ctx.tasks.clear();
                  for (let i = 0; i < todos.length; i++) {
                    const t = todos[i];
                    if (!t.content) continue;
                    const id = `todo-${i}`;
                    ctx.tasks.set(id, {
                      id,
                      subject: t.content,
                      status: (t.status as TaskItem["status"]) || "pending",
                      activeForm: t.activeForm,
                    });
                  }
                  results.push({
                    timestamp,
                    message: {
                      type: "activity",
                      activity: "task_list",
                      description: "Tasks",
                      tasks: Array.from(ctx.tasks.values()).map((t) => ({ ...t })),
                    } as ActivityMessage,
                  });
                }
              } else if (block.name === "TaskCreate" && input && block.id) {
                ctx.pendingTaskCreates?.set(block.id, {
                  subject: (input.subject as string) || "Untitled task",
                  activeForm: input.activeForm as string | undefined,
                });
              } else if (block.name === "TaskUpdate" && input) {
                const taskId = input.taskId as string;
                const status = input.status as string | undefined;
                if (taskId && status === "deleted") {
                  ctx.tasks?.delete(taskId);
                  results.push({
                    timestamp,
                    message: {
                      type: "activity",
                      activity: "task_list",
                      description: "Tasks",
                      tasks: Array.from(ctx.tasks?.values() ?? []).map((t) => ({ ...t })),
                    } as ActivityMessage,
                  });
                } else if (taskId && status && ctx.tasks?.has(taskId)) {
                  const task = ctx.tasks.get(taskId)!;
                  task.status = status as TaskItem["status"];
                  if (input.subject) task.subject = input.subject as string;
                  if (input.activeForm) task.activeForm = input.activeForm as string;
                  results.push({
                    timestamp,
                    message: {
                      type: "activity",
                      activity: "task_list",
                      description: "Tasks",
                      tasks: Array.from(ctx.tasks.values()).map((t) => ({ ...t })),
                    } as ActivityMessage,
                  });
                }
              }
              // TaskList and TaskGet — skip entirely (no activity emitted)
            } else if (
              ctx &&
              this.handleJsonlTeamTool(
                block.name || "",
                block.input as Record<string, unknown> | undefined,
                ctx,
                timestamp,
                results,
              )
            ) {
              // Team tool handled — suppressed from chat
            } else {
              // Track file changes for Edit/Write/NotebookEdit
              if (ctx?.files && block.name && FILE_WRITE_TOOLS.has(block.name)) {
                const input = block.input as Record<string, unknown> | undefined;
                const filePath = (input?.file_path || input?.path || input?.notebook_path) as
                  | string
                  | undefined;
                if (filePath) {
                  const existing = ctx.files.get(filePath);
                  if (existing) {
                    existing.editCount++;
                  } else {
                    ctx.files.set(filePath, {
                      path: filePath,
                      editCount: 1,
                      type: block.name === "Write" ? "added" : "edited",
                    });
                  }
                  results.push({
                    timestamp,
                    message: {
                      type: "activity",
                      activity: "file_list",
                      description: "Files changed",
                      files: Array.from(ctx.files.values()).map((f) => ({ ...f })),
                    } as ActivityMessage,
                  });
                }
              }

              results.push({
                timestamp,
                message: {
                  type: "activity",
                  activity: "tool_use",
                  tool: block.name,
                  description: describeToolUse(block.name || "Unknown", block.input),
                  detail: describeToolDetail(block.name || "Unknown", block.input),
                  input: block.input as Record<string, unknown> | undefined,
                  inputDescription: extractInputDescription(block.name || "Unknown", block.input),
                } as ActivityMessage,
              });
            }
          } else if (block.type === "tool_result" && ctx) {
            this.handleToolResultBlock(block, timestamp, ctx, results);
          } else if (block.type === "text" && block.text) {
            textParts.push(block.text);
          }
        }

        // Flush remaining text
        const remaining = stripInternalTags(textParts.join(""));
        if (remaining) {
          results.push({
            timestamp,
            message: {
              type: "output",
              text: remaining,
              isWaiting: false,
            } as OutputMessage,
          });
        }

        // Mark end of assistant turn
        results.push({
          timestamp,
          message: { type: "output", text: "", isWaiting: true } as OutputMessage,
        });
      }

      // Accumulate token usage from this assistant entry
      if (ctx?.stats && entry.message?.usage && entry.message?.model) {
        const usage = entry.message.usage;
        const u = {
          input_tokens: usage.input_tokens ?? 0,
          output_tokens: usage.output_tokens ?? 0,
          cache_creation_input_tokens: usage.cache_creation_input_tokens,
          cache_read_input_tokens: usage.cache_read_input_tokens,
        };
        ctx.stats.inputTokens += u.input_tokens;
        ctx.stats.outputTokens += u.output_tokens;
        ctx.stats.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
        ctx.stats.cacheReadTokens += u.cache_read_input_tokens ?? 0;
        ctx.stats.costUSD += estimateCost(entry.message.model, u);
      }
    }

    return results;
  }

  /**
   * Handle team-related tools during JSONL replay. Mirrors ClaudeProcess.handleTeamTool.
   * Returns true if the tool was handled and should be suppressed from chat.
   */
  private handleJsonlTeamTool(
    toolName: string,
    input: Record<string, unknown> | undefined,
    ctx: { team?: TeamInfo | null },
    timestamp: number,
    results: HistoryEntry[],
  ): boolean {
    if (!input) return false;

    if (toolName === "TeamCreate") {
      const team: TeamInfo = {
        name: (input.team_name as string) || "team",
        description: input.description as string | undefined,
        members: [],
      };
      ctx.team = team;
      results.push({
        timestamp,
        message: {
          type: "activity",
          activity: "team_info",
          description: "Team",
          team: { ...team, members: [] },
        } as ActivityMessage,
      });
      return true;
    }

    if (toolName === "Task" && input.team_name && ctx.team) {
      ctx.team.members.push({
        name: (input.name as string) || "agent",
        subagentType: (input.subagent_type as string) || "agent",
        description: (input.description as string) || "",
        status: "running",
        spawnedAt: timestamp,
      });
      results.push({
        timestamp,
        message: {
          type: "activity",
          activity: "team_info",
          description: "Team",
          team: { ...ctx.team, members: ctx.team.members.map((m) => ({ ...m })) },
        } as ActivityMessage,
      });
      return true;
    }

    if (toolName === "SendMessage" && input.type === "shutdown_request" && ctx.team) {
      const recipient = input.recipient as string | undefined;
      if (recipient) {
        const member = ctx.team.members.find((m) => m.name === recipient);
        if (member) {
          member.status = "shutting_down";
          results.push({
            timestamp,
            message: {
              type: "activity",
              activity: "team_info",
              description: "Team",
              team: { ...ctx.team, members: ctx.team.members.map((m) => ({ ...m })) },
            } as ActivityMessage,
          });
        }
      }
      return false; // Still show SendMessage as activity
    }

    if (toolName === "TeamDelete" && ctx.team) {
      for (const member of ctx.team.members) {
        member.status = "shutdown";
      }
      results.push({
        timestamp,
        message: {
          type: "activity",
          activity: "team_info",
          description: "Team",
          team: { ...ctx.team, members: ctx.team.members.map((m) => ({ ...m })) },
        } as ActivityMessage,
      });
      return true;
    }

    return false;
  }

  // ===========================================================================
  // JSONL file watching
  // ===========================================================================

  private startWatching(instanceId: string, instance: Instance): void {
    if (!instance.watchState) return;
    if (this.watchIntervals.has(instanceId)) return; // Already watching

    const interval = setInterval(() => {
      if (!instance.watchState) return;

      try {
        const stat = statSync(instance.watchState.jsonlPath);

        // Safety: if the file was truncated/rewritten, reset to beginning
        if (stat.size < instance.watchState.fileOffset) {
          instance.watchState.fileOffset = 0;
        }

        if (stat.size <= instance.watchState.fileOffset) return;

        // Read new bytes
        const fd = openSync(instance.watchState.jsonlPath, "r");
        let newContent: string;
        try {
          const buf = Buffer.alloc(stat.size - instance.watchState.fileOffset);
          readSync(fd, buf, 0, buf.length, instance.watchState.fileOffset);
          newContent = buf.toString("utf-8");
        } finally {
          closeSync(fd);
        }

        instance.watchState.fileOffset = stat.size;

        // When the relay's own process is active, it handles output via
        // wireProcessEvents. Suppress watcher emissions to avoid duplicates.
        if (instance.process?.isProcessing) return;

        for (const line of newContent.split("\n")) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (!instance.tasks) instance.tasks = new Map();
            if (!instance.files) instance.files = new Map();
            const prevCost = instance.watchState.stats.costUSD;
            const converted = this.convertJsonlEntry(entry, {
              pendingTools: instance.watchState.pendingTools,
              pendingTaskCreates: instance.watchState.pendingTaskCreates,
              tasks: instance.tasks,
              files: instance.files,
              stats: instance.watchState.stats,
            });
            // If stats changed, update instance info and broadcast
            if (instance.watchState.stats.costUSD !== prevCost) {
              instance.info.stats = { ...instance.watchState.stats };
              this.emit("instance:status", instanceId, { ...instance.info });
            }
            for (const histEntry of converted) {
              this.pushHistory(instance, histEntry.message);
              instance.info.lastActivityAt = Date.now();

              const msg = histEntry.message;
              if (msg.type === "output") {
                const output = msg as OutputMessage;
                if (output.isWaiting) {
                  this.setStatus(instance, "idle");
                  this.doRefreshTitle(instance);
                } else {
                  this.setStatus(instance, "processing");
                }
                this.emit("instance:output", instanceId, output);
              } else if (msg.type === "activity") {
                const activity = msg as ActivityMessage;
                if (
                  activity.activity === "tool_use" &&
                  INTERACTIVE_TOOLS.has(activity.tool || "")
                ) {
                  instance.info.pendingTool = activity.tool;
                } else if (activity.activity === "tool_result") {
                  instance.info.pendingTool = undefined;
                } else if (activity.activity === "team_info" && activity.team) {
                  instance.team = {
                    ...activity.team,
                    members: activity.team.members.map((m) => ({ ...m })),
                  };
                }
                this.setStatus(instance, "processing");
                this.emit("instance:activity", instanceId, activity);
              } else if (msg.type === "user") {
                instance.info.pendingTool = undefined;
                this.emit("instance:user", instanceId, msg as UserMessage);
              }
            }
          } catch {
            // skip malformed lines
          }
        }
      } catch {
        // File may have been deleted or moved — will be cleaned up by discovery
      }
    }, WATCH_POLL_INTERVAL);

    this.watchIntervals.set(instanceId, interval);
  }

  // ===========================================================================
  // Instance persistence (SQLite)
  // ===========================================================================

  /** Build a SessionRow from an in-memory Instance for DB upsert */
  private toSessionRow(instance: Instance): SessionRow {
    const stats = instance.info.stats;
    return {
      session_id: instance.sessionId!,
      instance_id: instance.info.id,
      name: instance.info.name,
      working_directory: instance.info.workingDirectory,
      jsonl_path: instance.jsonlPath!,
      created_at: instance.info.createdAt,
      last_activity_at: instance.info.lastActivityAt,
      type: instance.info.external ? "external" : "managed",
      archived: 0,
      custom_title: instance.info.customTitle ? 1 : 0,
      input_tokens: stats?.inputTokens ?? 0,
      output_tokens: stats?.outputTokens ?? 0,
      cache_creation_tokens: stats?.cacheCreationTokens ?? 0,
      cache_read_tokens: stats?.cacheReadTokens ?? 0,
      cost_usd: stats?.costUSD ?? 0,
      summary: null,
      first_prompt: null,
      git_branch: instance.gitBranch ?? null,
      message_count: 0,
      allowed_tools: "[]",
      worktree_path: instance.worktreePath ?? null,
      original_directory: instance.originalDirectory ?? null,
    };
  }

  /** Persist an instance to the DB (only if it has a sessionId and jsonlPath) */
  private dbSave(instance: Instance): void {
    if (!instance.sessionId || !instance.jsonlPath) return;
    try {
      this.db.upsert(this.toSessionRow(instance));
    } catch (err) {
      this.baseConfig.logger.warn(`[InstanceManager] Failed to persist session: ${err}`);
    }
  }

  /**
   * One-time migration from the legacy JSON manifest into SQLite.
   * Reads instances.json, imports rows preserving instance_id, then renames to .migrated.
   */
  private migrateFromManifest(): void {
    const manifestPath = this.baseConfig.manifestFile;
    if (!manifestPath) return;

    try {
      if (!existsSync(manifestPath)) return;
      const data = readFileSync(manifestPath, "utf-8");
      const entries = JSON.parse(data) as Array<{
        id: string;
        name: string;
        workingDirectory: string;
        sessionId: string;
        jsonlPath: string;
        createdAt: number;
        type?: "managed" | "external";
        lastActivityAt?: number;
        customTitle?: boolean;
      }>;

      if (!Array.isArray(entries) || entries.length === 0) {
        renameSync(manifestPath, `${manifestPath}.migrated`);
        return;
      }

      const rows: SessionRow[] = [];
      for (const entry of entries) {
        if (!entry.sessionId || !entry.jsonlPath) continue;
        if (!existsSync(entry.jsonlPath)) continue;
        rows.push({
          session_id: entry.sessionId,
          instance_id: entry.id,
          name: entry.name,
          working_directory: entry.workingDirectory,
          jsonl_path: entry.jsonlPath,
          created_at: entry.createdAt,
          last_activity_at: entry.lastActivityAt ?? entry.createdAt,
          type: entry.type ?? "managed",
          archived: 0,
          custom_title: entry.customTitle ? 1 : 0,
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_tokens: 0,
          cache_read_tokens: 0,
          cost_usd: 0,
          summary: null,
          first_prompt: null,
          git_branch: null,
          message_count: 0,
          allowed_tools: "[]",
          worktree_path: null,
          original_directory: null,
        });
      }

      if (rows.length > 0) {
        this.db.upsertMany(rows);
        this.baseConfig.logger.info(
          `[InstanceManager] Migrated ${rows.length} session(s) from manifest to SQLite`,
        );
      }

      renameSync(manifestPath, `${manifestPath}.migrated`);
    } catch (err) {
      this.baseConfig.logger.warn(`[InstanceManager] Manifest migration failed: ${err}`);
    }
  }

  /**
   * Scan all JSONL files on disk to discover sessions the DB doesn't know about.
   * If the JSONL exists, the session exists — period.
   */
  private scanAllSessions(): void {
    const projectsDir = join(this.claudeDir, "projects");
    if (!existsSync(projectsDir)) return;

    const knownPaths = this.db.getJsonlPaths();
    const diskPaths = new Set<string>();
    let discovered = 0;

    try {
      const projectDirs = readdirSync(projectsDir).filter((name) => {
        if (!name.startsWith("-")) return false;
        try {
          return statSync(join(projectsDir, name)).isDirectory();
        } catch {
          return false;
        }
      });

      const rows: SessionRow[] = [];

      for (const projDir of projectDirs) {
        const fullProjDir = join(projectsDir, projDir);
        let jsonlFiles: string[];
        try {
          jsonlFiles = readdirSync(fullProjDir).filter((f) => f.endsWith(".jsonl"));
        } catch {
          continue;
        }

        // Try to read sessions-index.json for fast metadata
        let sessionsIndex: Map<
          string,
          { summary?: string; createdAt?: number; lastActivityAt?: number; messageCount?: number }
        > | null = null;
        try {
          const indexPath = join(fullProjDir, "sessions-index.json");
          const indexData = JSON.parse(readFileSync(indexPath, "utf-8"));
          if (indexData.entries && Array.isArray(indexData.entries)) {
            sessionsIndex = new Map();
            for (const e of indexData.entries) {
              if (e.sessionId) {
                sessionsIndex.set(e.sessionId, {
                  summary: e.summary,
                  createdAt: e.createdAt ? new Date(e.createdAt).getTime() : undefined,
                  lastActivityAt: e.lastActivityAt
                    ? new Date(e.lastActivityAt).getTime()
                    : undefined,
                  messageCount: e.messageCount,
                });
              }
            }
          }
        } catch {
          // no index or parse error
        }

        for (const jsonlFile of jsonlFiles) {
          const jsonlPath = join(fullProjDir, jsonlFile);
          diskPaths.add(jsonlPath);

          if (knownPaths.has(jsonlPath)) {
            // Already in DB — update last_activity_at and repair working_directory if needed
            try {
              const mtime = Math.floor(statSync(jsonlPath).mtimeMs);
              const existing = this.db.getByJsonlPath(jsonlPath);
              if (existing) {
                if (mtime > existing.last_activity_at) {
                  this.db.updateLastActivity(existing.session_id, mtime);
                }
                // Repair corrupted working_directory: re-read from JSONL and validate
                let correctCwd = readCwdFromJsonl(jsonlPath);
                if (correctCwd && !existsSync(correctCwd)) {
                  // JSONL cwd is stale (project renamed?) — try filesystem decode
                  const decoded = decodeProjectDir(projDir);
                  if (existsSync(decoded)) correctCwd = decoded;
                }
                if (!correctCwd) {
                  // No JSONL cwd — try filesystem decode
                  const decoded = decodeProjectDir(projDir);
                  if (existsSync(decoded)) correctCwd = decoded;
                }
                if (correctCwd && correctCwd !== existing.working_directory) {
                  this.db.updateWorkingDirectory(existing.session_id, correctCwd);
                }
              }
            } catch {
              // ignore stat errors
            }
            continue;
          }

          // New file — discover session
          const sessionId = jsonlFile.replace(".jsonl", "");
          const indexEntry = sessionsIndex?.get(sessionId);

          // Try to resolve CWD from JSONL, with filesystem-validated fallback
          let cwd = readCwdFromJsonl(jsonlPath) || "";
          let createdAt = 0;
          if (cwd && !existsSync(cwd)) {
            // JSONL cwd is stale (project renamed?) — try filesystem decode
            const decoded = decodeProjectDir(projDir);
            if (existsSync(decoded)) cwd = decoded;
          }
          if (!cwd) {
            // No JSONL cwd — use filesystem-validated decode
            cwd = decodeProjectDir(projDir);
          }
          try {
            const head = readFileSync(jsonlPath, "utf-8").split("\n")[0];
            const parsed = JSON.parse(head);
            if (parsed.timestamp) {
              const ts = new Date(parsed.timestamp).getTime();
              if (!isNaN(ts)) createdAt = ts;
            }
          } catch {
            // ignore
          }

          let lastActivityAt: number;
          try {
            lastActivityAt = Math.floor(statSync(jsonlPath).mtimeMs);
          } catch {
            lastActivityAt = Date.now();
          }

          if (!createdAt) {
            createdAt = indexEntry?.createdAt ?? lastActivityAt;
          }

          const name = indexEntry?.summary || generateTitle(sessionId);

          rows.push({
            session_id: sessionId,
            instance_id: randomUUID(),
            name,
            working_directory: cwd,
            jsonl_path: jsonlPath,
            created_at: createdAt,
            last_activity_at: indexEntry?.lastActivityAt ?? lastActivityAt,
            type: "external",
            archived: 0,
            custom_title: 0,
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
            cost_usd: 0,
            summary: indexEntry?.summary ?? null,
            first_prompt: null,
            git_branch: null,
            message_count: indexEntry?.messageCount ?? 0,
            allowed_tools: "[]",
            worktree_path: null,
            original_directory: null,
          });
          discovered++;
        }
      }

      if (rows.length > 0) {
        this.db.upsertMany(rows);
      }
    } catch (err) {
      this.baseConfig.logger.warn(`[InstanceManager] Session scan failed: ${err}`);
    }

    // Archive sessions whose JSONL no longer exists on disk
    // Only consider paths under the scanned projectsDir
    let archived = 0;
    for (const knownPath of knownPaths) {
      if (!knownPath.startsWith(projectsDir)) continue;
      if (!diskPaths.has(knownPath)) {
        const row = this.db.getByJsonlPath(knownPath);
        if (row && !row.archived) {
          this.db.archive(row.session_id);
          archived++;
        }
      }
    }

    // Archive sessions from deleted or temp directories
    for (const row of this.db.getAllActive()) {
      if (!row.working_directory) continue;
      const isTempDir = /^(\/private)?\/tmp(\/|$)/.test(row.working_directory);
      if (isTempDir || !existsSync(row.working_directory)) {
        this.db.archive(row.session_id);
        archived++;
      }
    }

    if (discovered > 0 || archived > 0) {
      this.baseConfig.logger.info(
        `[InstanceManager] Session scan: ${discovered} discovered, ${archived} archived`,
      );
    }
  }

  restoreInstances(): void {
    this.migrateFromManifest();
    this.scanAllSessions();

    if (this.db.needsRebuild) {
      this.baseConfig.logger.info("[InstanceManager] DB was rebuilt from JSONL scan");
    }

    const entries = this.db.getAllActive();
    if (entries.length === 0) return;

    let restored = 0;
    for (const entry of entries) {
      if (!existsSync(entry.jsonl_path)) {
        this.db.archive(entry.session_id);
        continue;
      }

      const { history, tasks, files, team, stats } = this.parseJsonl(entry.jsonl_path);
      const parsedStats = stats.costUSD > 0 ? stats : undefined;

      const lastMessage = extractLastMessage(history);

      if (parsedStats) {
        this.db.updateStats(entry.session_id, {
          inputTokens: parsedStats.inputTokens,
          outputTokens: parsedStats.outputTokens,
          cacheCreationTokens: parsedStats.cacheCreationTokens,
          cacheReadTokens: parsedStats.cacheReadTokens,
          costUSD: parsedStats.costUSD,
        });
      }

      if (entry.type === "external") {
        const info: InstanceInfo = {
          id: entry.instance_id,
          name: entry.name,
          workingDirectory: entry.working_directory,
          status: "stopped",
          createdAt: entry.created_at,
          lastActivityAt: entry.last_activity_at,
          external: true,
          lastMessage,
          sessionId: entry.session_id,
          customTitle: entry.custom_title === 1,
          stats: parsedStats,
          gitInfo: getGitInfo(entry.working_directory) ?? undefined,
        };

        const instance: Instance = {
          info,
          process: null,
          history,
          sessionId: entry.session_id,
          jsonlPath: entry.jsonl_path,
          tasks: tasks.size > 0 ? tasks : undefined,
          files: files.size > 0 ? files : undefined,
          team: team ?? undefined,
        };

        this.instances.set(entry.instance_id, instance);
        this.emit("instance:created", entry.instance_id, { ...info });
        restored++;
      } else {
        // Determine the actual CWD — use worktree if it still exists on disk
        let restoreActualCwd = entry.working_directory;
        let restoreWorktreePath: string | undefined;
        let restoreGitBranch: string | undefined;
        let restoreOriginalDirectory: string | undefined;

        if (entry.worktree_path && entry.original_directory) {
          if (existsSync(entry.worktree_path)) {
            restoreActualCwd = entry.worktree_path;
            restoreWorktreePath = entry.worktree_path;
            restoreGitBranch = entry.git_branch ?? undefined;
            restoreOriginalDirectory = entry.original_directory;
          } else {
            this.baseConfig.logger.warn(
              `[InstanceManager] Worktree ${entry.worktree_path} no longer exists, using original directory`,
            );
          }
        }

        const instanceConfig: CoreConfig = {
          ...this.baseConfig,
          workingDirectory: restoreActualCwd,
        };

        const proc = new ClaudeProcess(instanceConfig, { resumeSessionId: entry.session_id });

        // Restore previously approved tools from DB
        try {
          const savedTools = JSON.parse(entry.allowed_tools) as string[];
          for (const t of savedTools) {
            proc.addAllowedTool(t);
          }
          if (savedTools.length > 0) {
            this.baseConfig.logger.debug(
              `[InstanceManager] Restored ${savedTools.length} allowed tool(s) for session ${entry.session_id}`,
            );
          }
        } catch {
          // ignore parse errors
        }

        const info: InstanceInfo = {
          id: entry.instance_id,
          name: entry.name,
          workingDirectory: entry.working_directory,
          status: "idle",
          createdAt: entry.created_at,
          lastActivityAt: entry.last_activity_at,
          lastMessage,
          sessionId: entry.session_id,
          customTitle: entry.custom_title === 1,
          stats: parsedStats,
          gitBranch: restoreGitBranch,
          originalDirectory: restoreOriginalDirectory,
          gitInfo: getGitInfo(entry.working_directory) ?? undefined,
        };

        let watchState: WatchState | undefined;
        try {
          watchState = createWatchState(
            entry.jsonl_path,
            statSync(entry.jsonl_path).size,
            parsedStats,
          );
        } catch {
          // ignore — file stat failure handled by startWatching guard
        }

        const instance: Instance = {
          info,
          process: proc,
          history,
          sessionId: entry.session_id,
          jsonlPath: entry.jsonl_path,
          watchState,
          tasks: tasks.size > 0 ? tasks : undefined,
          files: files.size > 0 ? files : undefined,
          team: team ?? undefined,
          worktreePath: restoreWorktreePath,
          gitBranch: restoreGitBranch,
          originalDirectory: restoreOriginalDirectory,
          actualCwd: restoreWorktreePath ? restoreActualCwd : undefined,
        };

        this.instances.set(entry.instance_id, instance);
        this.wireProcessEvents(entry.instance_id, instance, proc);
        this.startWatching(entry.instance_id, instance);

        this.emit("instance:created", entry.instance_id, { ...info });
        restored++;
      }
    }

    if (restored > 0) {
      this.baseConfig.logger.info(
        `[InstanceManager] Restored ${restored} instance(s) from database`,
      );
    }

    this.stitchExistingPlanSessions();
  }

  private stitchExistingPlanSessions(): void {
    let stitchedAny = false;
    let found: boolean;

    do {
      found = false;

      for (const [childId, child] of this.instances) {
        const jsonlPath = child.jsonlPath || child.externalState?.jsonlPath;
        if (!jsonlPath) continue;

        const parent = this.findPlanParent(jsonlPath);
        if (!parent || parent.info.id === childId) continue;

        parent.history.push({
          timestamp: Date.now(),
          message: {
            type: "output",
            text: "--- Session continued ---",
            isWaiting: false,
          } as OutputMessage,
        });
        for (const entry of child.history) {
          parent.history.push(entry);
        }
        if (parent.history.length > MAX_HISTORY) {
          parent.history.splice(0, parent.history.length - MAX_HISTORY);
        }

        const sessionId =
          child.sessionId ||
          child.externalState?.sessionId ||
          jsonlPath.split("/").pop()?.replace(".jsonl", "") ||
          "";
        parent.sessionId = sessionId;
        parent.jsonlPath = jsonlPath;
        parent.info.sessionId = sessionId;

        if (child.info.lastActivityAt > parent.info.lastActivityAt) {
          parent.info.lastActivityAt = child.info.lastActivityAt;
        }
        if (child.info.lastMessage) {
          parent.info.lastMessage = child.info.lastMessage;
        }

        if (child.tasks && child.tasks.size > 0) {
          parent.tasks = child.tasks;
        }
        if (child.files && child.files.size > 0) {
          parent.files = child.files;
        }

        this.baseConfig.logger.info(
          `[InstanceManager] Retroactively stitched "${child.info.name}" into "${parent.info.name}"`,
        );

        // Remove child instance (cleans up watcher, emits removed, archives in DB)
        this.removeInstance(childId);
        found = true;
        stitchedAny = true;
        break; // Restart iteration — map was modified
      }
    } while (found);

    if (stitchedAny) {
      for (const instance of this.instances.values()) {
        this.emit("instance:status", instance.info.id, { ...instance.info });
        this.dbSave(instance);
      }
    }
  }

  // ===========================================================================
  // Event wiring
  // ===========================================================================

  private wireProcessEvents(id: string, instance: Instance, proc: ClaudeProcess): void {
    proc.on("output", (message) => {
      this.pushHistory(instance, message);
      instance.info.lastActivityAt = Date.now();

      if (message.isWaiting) {
        // Advance watcher offset so it doesn't re-emit what the process already handled
        if (instance.watchState) {
          try {
            instance.watchState.fileOffset = statSync(instance.watchState.jsonlPath).size;
          } catch {
            // ignore — file may not exist yet
          }
        }

        // Drain pending tool-approval retry before going idle
        if (instance.pendingRetry) {
          const retryText = instance.pendingRetry;
          instance.pendingRetry = undefined;
          const userMessage: UserMessage = { type: "user", text: retryText, instanceId: id };
          this.pushHistory(instance, userMessage);
          instance.info.lastActivityAt = Date.now();
          this.setStatus(instance, "processing");
          instance.process!.send(retryText);
        } else {
          this.setStatus(instance, "idle");
          this.doRefreshTitle(instance);
        }
      } else {
        this.setStatus(instance, "processing");
      }

      this.emit("instance:output", id, message);
    });

    proc.on("activity", (message) => {
      // Sync task state from process to instance
      if (message.activity === "task_list" && message.tasks) {
        if (!instance.tasks) instance.tasks = new Map();
        instance.tasks.clear();
        for (const t of message.tasks) {
          instance.tasks.set(t.id, { ...t });
        }
      }
      // Sync file state from process to instance
      if (message.activity === "file_list" && message.files) {
        if (!instance.files) instance.files = new Map();
        instance.files.clear();
        for (const f of message.files) {
          instance.files.set(f.path, { ...f });
        }
      }
      // Sync team state from process to instance
      if (message.activity === "team_info" && message.team) {
        instance.team = { ...message.team, members: message.team.members.map((m) => ({ ...m })) };
      }
      // Track permission denials for the banner
      if (message.permissionDenied) {
        instance.info.pendingPermission = message.permissionDenied;
        this.emit("instance:status", id, { ...instance.info });
      }
      this.pushHistory(instance, message);
      instance.info.lastActivityAt = Date.now();
      this.setStatus(instance, "processing");
      this.emit("instance:activity", id, message);
    });

    proc.on("stats", (stats) => {
      instance.info.stats = stats;
      this.emit("instance:status", id, { ...instance.info });
    });

    proc.on("exit", (message) => {
      this.pushHistory(instance, message);
      instance.info.lastActivityAt = Date.now();
      if (message.code !== 0) {
        this.setStatus(instance, "error");
      }
      this.emit("instance:exit", id, message);
    });
  }

  private captureSessionId(id: string, instance: Instance, proc: ClaudeProcess): void {
    const onOutput = (message: OutputMessage) => {
      if (!message.isWaiting) return;

      // One-shot: remove this listener after first capture
      proc.off("output", onOutput);

      const cwd = instance.actualCwd || instance.info.workingDirectory;
      const encoded = cwd.replace(/\//g, "-");
      const projectDir = join(this.claudeDir, "projects", encoded);

      if (!existsSync(projectDir)) return;

      try {
        const files = readdirSync(projectDir)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => {
            const fullPath = join(projectDir, f);
            try {
              return { path: fullPath, mtime: statSync(fullPath).mtimeMs };
            } catch {
              return null;
            }
          })
          .filter((f): f is { path: string; mtime: number } => f !== null);

        files.sort((a, b) => b.mtime - a.mtime);
        if (files.length === 0) return;

        const newestJsonl = files[0];
        const fileName = newestJsonl.path.split("/").pop() || "";
        const sessionId = fileName.replace(".jsonl", "");

        instance.sessionId = sessionId;
        instance.jsonlPath = newestJsonl.path;
        instance.info.sessionId = sessionId;

        // Feed session ID back to the process so subsequent sends use
        // --resume <id> instead of --continue (which can pick up the wrong session).
        proc.setSessionId(sessionId);

        // Start JSONL watching so terminal-side changes are picked up.
        // If a watcher exists on a different path (e.g. resumed session got a new JSONL),
        // replace it. If already watching the same path, skip.
        if (instance.watchState?.jsonlPath !== newestJsonl.path) {
          const oldInterval = this.watchIntervals.get(id);
          if (oldInterval) {
            clearInterval(oldInterval);
            this.watchIntervals.delete(id);
          }
          try {
            instance.watchState = createWatchState(
              newestJsonl.path,
              statSync(newestJsonl.path).size,
              instance.info.stats,
            );
            this.startWatching(id, instance);
          } catch {
            // ignore — file may have been removed between checks
          }
        }

        this.dbSave(instance);

        this.baseConfig.logger.debug(
          `[InstanceManager] Captured session ID "${sessionId}" for instance "${instance.info.name}"`,
        );
      } catch (err) {
        this.baseConfig.logger.debug(
          `[InstanceManager] Failed to capture session ID for "${instance.info.name}": ${err}`,
        );
      }
    };

    proc.on("output", onOutput);
  }

  // ===========================================================================
  // Internal helpers
  // ===========================================================================

  /**
   * Try to find a good title for an external session:
   * 1. Check sessions-index.json for a summary
   * 2. Fall back to first user message
   */
  private resolveSessionTitle(
    sessionId: string,
    cwd: string,
    history: HistoryEntry[],
  ): string | null {
    // Try sessions-index.json summary
    const summary = this.getSessionSummary(sessionId, cwd);
    if (summary) return summary;

    // Fall back to first user message
    for (const h of history) {
      if (h.message.type === "user" && (h.message as UserMessage).text) {
        return generateTitle((h.message as UserMessage).text);
      }
    }

    return null;
  }

  /**
   * Look up the summary for a session from sessions-index.json.
   */
  private getSessionSummary(sessionId: string, cwd: string): string | null {
    const encoded = cwd.replace(/\//g, "-");
    const indexPath = join(this.claudeDir, "projects", encoded, "sessions-index.json");
    try {
      const indexData = JSON.parse(readFileSync(indexPath, "utf-8"));
      if (indexData.entries && Array.isArray(indexData.entries)) {
        const entry = indexData.entries.find(
          (e: { sessionId?: string }) => e.sessionId === sessionId,
        );
        if (entry?.summary) return entry.summary;
      }
    } catch {
      // no index or parse error
    }
    return null;
  }

  /**
   * Check sessions-index.json for an updated summary and evolve the
   * instance title if it has changed. Called at turn boundaries and
   * available for manual refresh via WS/API.
   */
  refreshTitle(id: string): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;
    // Explicit refresh clears the custom-title lock
    instance.info.customTitle = false;
    return this.doRefreshTitle(instance);
  }

  renameInstance(id: string, name: string): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;
    const trimmed = name.trim();
    if (!trimmed) return false;

    instance.info.name = trimmed;
    instance.info.customTitle = true;
    this.emit("instance:status", instance.info.id, { ...instance.info });
    const sid = instance.sessionId || instance.info.sessionId;
    if (sid) this.db.updateName(sid, trimmed, true);
    return true;
  }

  private doRefreshTitle(instance: Instance): boolean {
    if (instance.info.customTitle) return false;

    const sessionId = instance.sessionId || instance.info.sessionId;
    if (!sessionId) return false;

    // Best source: sessions-index.json summary (generated by Claude CLI)
    const summary = this.getSessionSummary(sessionId, instance.info.workingDirectory);
    if (summary && summary !== instance.info.name) {
      instance.info.name = summary;
      this.emit("instance:status", instance.info.id, { ...instance.info });
      if (sessionId) this.db.updateName(sessionId, summary, false);
      return true;
    }

    // Fallback: last user message from history (reflects recent context)
    for (let i = instance.history.length - 1; i >= 0; i--) {
      const msg = instance.history[i].message;
      if (msg.type === "user" && (msg as UserMessage).text) {
        const title = generateTitle((msg as UserMessage).text);
        if (title && title !== instance.info.name) {
          instance.info.name = title;
          this.emit("instance:status", instance.info.id, { ...instance.info });
          const sid = instance.sessionId || instance.info.sessionId;
          if (sid) this.db.updateName(sid, title, false);
          return true;
        }
        break;
      }
    }

    return false;
  }

  private setStatus(instance: Instance, status: InstanceStatus): void {
    if (instance.info.status === status) return;
    instance.info.status = status;
    this.emit("instance:status", instance.info.id, { ...instance.info });
  }

  private pushHistory(instance: Instance, message: ServerMessage): void {
    const now = Date.now();
    instance.history.push({ timestamp: now, message });
    if (instance.history.length > MAX_HISTORY) {
      instance.history.splice(0, instance.history.length - MAX_HISTORY);
    }

    // Track last meaningful message for dashboard preview
    if (message.type === "user" && (message as UserMessage).text) {
      instance.info.lastMessage = {
        text: (message as UserMessage).text,
        from: "user",
        timestamp: now,
      };
    } else if (message.type === "output") {
      const output = message as OutputMessage;
      if (output.text && output.text.trim() && !output.isWaiting) {
        instance.info.lastMessage = {
          text: output.text,
          from: "claude",
          timestamp: now,
        };
      }
    }
  }
}
