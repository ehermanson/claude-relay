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
  writeFileSync,
  mkdirSync,
  statSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
} from "fs";
import { dirname } from "path";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { ClaudeProcess } from "./claude-process.js";
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
} from "./types.js";
import { describeToolUse, describeToolDetail, isPermissionDenial } from "./tools.js";

// =============================================================================
// Re-exports
// =============================================================================

export type { InstanceStatus, LastMessagePreview, InstanceInfo, HistoryEntry } from "./types.js";

// =============================================================================
// Internal Types
// =============================================================================

interface ExternalState {
  jsonlPath: string;
  fileOffset: number;
  sessionId: string;
}

interface WatchState {
  jsonlPath: string;
  fileOffset: number;
  /** Tracks tool_use_id → tool name for permission denial attribution */
  pendingTools: Map<string, string>;
}

interface ManifestEntry {
  id: string;
  name: string;
  workingDirectory: string;
  sessionId: string;
  jsonlPath: string;
  dangerouslySkipPermissions: boolean;
  createdAt: number;
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
    listener: (...args: InstanceManagerEvents[E]) => void
  ): this;
  emit<E extends keyof InstanceManagerEvents>(
    event: E,
    ...args: InstanceManagerEvents[E]
  ): boolean;
  off<E extends keyof InstanceManagerEvents>(
    event: E,
    listener: (...args: InstanceManagerEvents[E]) => void
  ): this;
}

// =============================================================================
// InstanceManager Class
// =============================================================================

const MAX_HISTORY = 1000;
const DISCOVERY_INTERVAL = 10_000; // 10s
const WATCH_POLL_INTERVAL = 2_000; // 2s
const MAX_TITLE_LENGTH = 50;

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

const INTERNAL_TAG_RE = new RegExp(
  `<(${INTERNAL_TAGS.join("|")})[^>]*>[\\s\\S]*?</\\1>`,
  "g"
);

function stripInternalTags(text: string): string {
  return text.replace(INTERNAL_TAG_RE, "").trim();
}

/** Generate a short session title from the first user message. */
function generateTitle(text: string): string {
  // Take the first line, strip markdown/special chars
  const firstLine = text.split("\n")[0].replace(/[#*`_~\[\]>]/g, "").trim();
  if (!firstLine) return "New session";
  if (firstLine.length <= MAX_TITLE_LENGTH) return firstLine;
  // Truncate at word boundary
  const truncated = firstLine.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + "\u2026";
}

export class InstanceManager extends EventEmitter {
  private instances = new Map<string, Instance>();
  private baseConfig: CoreConfig;
  private instanceCounter = 0;
  private discoveryInterval: ReturnType<typeof setInterval> | null = null;
  private watchIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private claudeDir = join(homedir(), ".claude");

  constructor(config: CoreConfig) {
    super();
    this.baseConfig = config;
  }

  // ===========================================================================
  // Managed instances (read-write, spawned by relay)
  // ===========================================================================

  createInstance(options?: {
    name?: string;
    workingDirectory?: string;
    dangerouslySkipPermissions?: boolean;
  }): InstanceInfo {
    if (this.instances.size >= this.baseConfig.maxInstances) {
      throw new Error(`Maximum instances (${this.baseConfig.maxInstances}) reached`);
    }

    const id = randomUUID();
    this.instanceCounter++;
    const name = options?.name || `Instance ${this.instanceCounter}`;
    const workingDirectory = options?.workingDirectory || this.baseConfig.workingDirectory;
    const now = Date.now();

    const instanceConfig: CoreConfig = {
      ...this.baseConfig,
      workingDirectory,
      dangerouslySkipPermissions:
        options?.dangerouslySkipPermissions ?? this.baseConfig.dangerouslySkipPermissions,
    };

    const proc = new ClaudeProcess(instanceConfig);
    const info: InstanceInfo = {
      id,
      name,
      workingDirectory,
      status: "idle",
      createdAt: now,
      lastActivityAt: now,
    };

    const dirBasename = workingDirectory.split("/").pop() || "";
    const hasCustomName = !!(options?.name && options.name !== dirBasename);
    const instance: Instance = { info, process: proc, history: [], autoTitle: !hasCustomName };
    this.instances.set(id, instance);

    this.wireProcessEvents(id, instance, proc);
    this.captureSessionId(id, instance, proc);

    this.baseConfig.logger.info(`[InstanceManager] Created instance "${name}" (${id})`);
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
    this.saveManifest();
    this.baseConfig.logger.info(`[InstanceManager] Removed instance "${instance.info.name}" (${id})`);
    return true;
  }

  listInstances(): InstanceInfo[] {
    return Array.from(this.instances.values()).map((i) => ({ ...i.info }));
  }

  getInstance(id: string): InstanceInfo | undefined {
    const instance = this.instances.get(id);
    return instance ? { ...instance.info } : undefined;
  }

  sendMessage(id: string, text: string): void {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`Instance ${id} not found`);
    if (instance.info.external) throw new Error("Cannot send messages to external instances");

    // Auto-title from first user message
    if (instance.autoTitle) {
      instance.info.name = generateTitle(text);
      instance.autoTitle = false;
    }

    // Store user message in history so replay works across devices
    const userMessage: UserMessage = { type: "user", text, instanceId: id };
    this.pushHistory(instance, userMessage);

    // Immediately reflect processing status
    instance.info.lastActivityAt = Date.now();
    instance.info.waitingForInput = false;
    this.setStatus(instance, "processing");

    instance.process!.send(text);
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

    instance.process!.addAllowedTool(tool);

    const retryText = `I've granted permission for ${tool}. Please retry your last action.`;
    const userMessage: UserMessage = { type: "user", text: retryText, instanceId: id };
    this.pushHistory(instance, userMessage);

    instance.info.lastActivityAt = Date.now();
    instance.info.waitingForInput = false;
    this.setStatus(instance, "processing");

    instance.process!.send(retryText);
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
    const cwd = instance.info.workingDirectory;

    // JSONL watcher keeps running — watchState is independent of externalState.
    // The watcher suppresses emissions while the process is active (dedup),
    // and picks up terminal-side changes when the process is idle.

    // Create a ClaudeProcess that resumes the session
    const instanceConfig: CoreConfig = {
      ...this.baseConfig,
      workingDirectory: cwd,
    };

    const proc = new ClaudeProcess(instanceConfig, { resumeSessionId: sessionId });

    // Preserve session info so discovery doesn't re-create this instance
    instance.sessionId = sessionId;
    instance.jsonlPath = jsonlPath;

    // Convert from external to managed
    instance.process = proc;
    instance.info.external = false;
    delete instance.externalState;

    this.wireProcessEvents(id, instance, proc);
    this.captureSessionId(id, instance, proc);
    this.setStatus(instance, "idle");
    this.saveManifest();
    this.baseConfig.logger.info(
      `[InstanceManager] Resumed session "${instance.info.name}" (claude session: ${sessionId})`
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
          const decoded = name.replace(/-/g, "/");
          let lastUsed = 0;
          try {
            // Use the most recent jsonl file's mtime as last used time
            const files = readdirSync(join(projectsDir, name))
              .filter((f) => f.endsWith(".jsonl"))
              .map((f) => {
                try {
                  return statSync(join(projectsDir, name, f)).mtimeMs;
                } catch {
                  return 0;
                }
              });
            lastUsed = files.length > 0 ? Math.max(...files) : 0;
          } catch {
            // ignore
          }
          return { path: decoded, lastUsed };
        })
        .filter((d) => existsSync(d.path)) // only include dirs that still exist
        .sort((a, b) => b.lastUsed - a.lastUsed);
    } catch {
      return [];
    }
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
    }
    this.instances.clear();
    this.stopDiscovery();
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

    // Find running claude processes — returns cwds with counts (multiple PIDs per cwd)
    const cwdCounts = this.findRunningClaudeCwds();
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

    // Discover new sessions
    for (const [jsonlPath] of activeJsonls) {
      if (knownJsonls.has(jsonlPath)) continue;

      const fileName = jsonlPath.split("/").pop() || "";
      const sessionId = fileName.replace(".jsonl", "");

      try {
        this.addExternalInstance(sessionId, jsonlPath);
      } catch (err) {
        this.baseConfig.logger.debug(
          `[InstanceManager] Failed to add external session: ${err}`
        );
      }
    }
  }

  /** Returns a map of cwd → number of claude PIDs running in that directory */
  private findRunningClaudeCwds(): Map<string, number> {
    const cwdCounts = new Map<string, number>();
    try {
      const psOutput = execSync(
        "ps -eo pid,comm 2>/dev/null | grep -E '\\bclaude$' || true",
        { encoding: "utf-8", timeout: 5000 }
      );

      const pids: number[] = [];
      for (const line of psOutput.split("\n")) {
        const match = line.trim().match(/^(\d+)\s/);
        if (match) pids.push(parseInt(match[1]));
      }

      for (const pid of pids) {
        try {
          const lsofOutput = execSync(
            `lsof -p ${pid} -a -d cwd -Fn 2>/dev/null || true`,
            { encoding: "utf-8", timeout: 5000 }
          );
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
        this.setStatus(instance, "stopped");
        const watchInterval = this.watchIntervals.get(instanceId);
        if (watchInterval) {
          clearInterval(watchInterval);
          this.watchIntervals.delete(instanceId);
        }
        this.instances.delete(instanceId);
        this.emit("instance:removed", instanceId);
        this.baseConfig.logger.info(
          `[InstanceManager] External session ended: "${instance.info.name}"`
        );
      }
    }
  }

  private addExternalInstance(sessionId: string, jsonlPath: string): void {
    const { cwd, slug, history } = this.parseJsonl(jsonlPath);
    if (!cwd) return; // Can't determine working directory

    const id = randomUUID();
    const dirName = cwd.split("/").pop() || "unknown";
    const name = this.resolveSessionTitle(sessionId, cwd, history) || dirName;
    const now = Date.now();
    const lastActivity = history.length > 0 ? history[history.length - 1].timestamp : now;

    // Find the last user or claude message for the dashboard preview
    let lastMessage: LastMessagePreview | undefined;
    let waitingForInput = false;
    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i].message;
      if (msg.type === "user" && (msg as UserMessage).text) {
        lastMessage = { text: (msg as UserMessage).text, from: "user", timestamp: history[i].timestamp };
        break;
      } else if (msg.type === "output") {
        const output = msg as OutputMessage;
        if (output.isWaiting) {
          waitingForInput = true;
        } else if (output.text && output.text.trim()) {
          lastMessage = { text: output.text, from: "claude", timestamp: history[i].timestamp };
          break;
        }
      }
    }

    const info: InstanceInfo = {
      id,
      name,
      workingDirectory: cwd,
      status: "idle",
      createdAt: lastActivity,
      lastActivityAt: lastActivity,
      external: true,
      lastMessage,
      waitingForInput,
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
      externalState: {
        jsonlPath,
        fileOffset: fileSize,
        sessionId,
      },
      watchState: {
        jsonlPath,
        fileOffset: fileSize,
        pendingTools: new Map(),
      },
    };

    this.instances.set(id, instance);
    this.startWatching(id, instance);
    this.emit("instance:created", id, { ...info });

    this.baseConfig.logger.info(
      `[InstanceManager] Discovered external session "${name}" in ${cwd}`
    );
  }

  // ===========================================================================
  // JSONL parsing
  // ===========================================================================

  private parseJsonl(filePath: string): {
    cwd: string;
    slug: string;
    history: HistoryEntry[];
  } {
    let fileSize: number;
    try {
      fileSize = statSync(filePath).size;
    } catch {
      return { cwd: "", slug: "", history: [] };
    }

    // For large files, only read the first few KB (for metadata) and the last chunk (for history)
    const MAX_TAIL_BYTES = 512 * 1024; // 512KB tail for history
    const HEAD_BYTES = 4096; // 4KB head for cwd/slug metadata

    let cwd = "";
    let slug = "";

    // Always read head for metadata
    try {
      const fd = openSync(filePath, "r");
      try {
        const headSize = Math.min(HEAD_BYTES, fileSize);
        const headBuf = Buffer.alloc(headSize);
        readSync(fd, headBuf, 0, headSize, 0);
        const headContent = headBuf.toString("utf-8");
        for (const line of headContent.split("\n")) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (!cwd && entry.cwd) cwd = entry.cwd;
            if (!slug && entry.slug) slug = entry.slug;
            if (cwd && slug) break;
          } catch {
            // partial line at boundary — skip
          }
        }
      } finally {
        closeSync(fd);
      }
    } catch {
      return { cwd: "", slug: "", history: [] };
    }

    // Read history from tail (or full file if small enough)
    const history: HistoryEntry[] = [];
    try {
      let tailContent: string;
      if (fileSize <= MAX_TAIL_BYTES) {
        tailContent = readFileSync(filePath, "utf-8");
      } else {
        const fd = openSync(filePath, "r");
        try {
          const tailBuf = Buffer.alloc(MAX_TAIL_BYTES);
          readSync(fd, tailBuf, 0, MAX_TAIL_BYTES, fileSize - MAX_TAIL_BYTES);
          tailContent = tailBuf.toString("utf-8");
          // Drop first partial line
          const firstNewline = tailContent.indexOf("\n");
          if (firstNewline >= 0) {
            tailContent = tailContent.substring(firstNewline + 1);
          }
        } finally {
          closeSync(fd);
        }
      }

      const replayTools = new Map<string, string>();
      for (const line of tailContent.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          // Also grab metadata from tail lines in case head didn't have it
          if (!cwd && entry.cwd) cwd = entry.cwd;
          if (!slug && entry.slug) slug = entry.slug;

          const converted = this.convertJsonlEntry(entry, replayTools);
          for (const h of converted) {
            history.push(h);
          }
        } catch {
          // skip
        }
      }
    } catch {
      // return whatever we have
    }

    // Trim to MAX_HISTORY
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }

    return { cwd, slug, history };
  }

  private convertJsonlEntry(entry: {
    type?: string;
    timestamp?: string;
    message?: {
      role?: string;
      content?: string | Array<{ type: string; text?: string; thinking?: string; name?: string; id?: string; input?: Record<string, unknown>; is_error?: boolean; content?: string; tool_use_id?: string }>;
    };
  }, pendingTools?: Map<string, string>): HistoryEntry[] {
    const results: HistoryEntry[] = [];
    const timestamp = entry.timestamp
      ? new Date(entry.timestamp).getTime()
      : Date.now();

    if (entry.type === "user" && entry.message?.content) {
      const content = entry.message.content;
      let text = "";
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        text = content
          .filter((c) => c.type === "text" && c.text)
          .map((c) => c.text!)
          .join("\n");
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
                detail:
                  block.thinking.slice(0, 500) +
                  (block.thinking.length > 500 ? "..." : ""),
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
            results.push({
              timestamp,
              message: {
                type: "activity",
                activity: "tool_use",
                tool: block.name,
                description: describeToolUse(block.name || "Unknown", block.input),
                detail: describeToolDetail(
                  block.name || "Unknown",
                  block.input
                ),
                input: block.input as Record<string, unknown> | undefined,
              } as ActivityMessage,
            });
          } else if (block.type === "tool_result") {
            const blockContent = block.content || "";
            const denied = block.is_error && isPermissionDenial(blockContent);
            const deniedTool = denied ? (pendingTools?.get(block.tool_use_id || "") || "Unknown") : undefined;
            results.push({
              timestamp,
              message: {
                type: "activity",
                activity: "tool_result",
                description: deniedTool ? "Permission denied" : block.is_error ? "Tool error" : "Tool completed",
                tool: deniedTool,
                detail: blockContent.slice(0, 200) || undefined,
                permissionDenied: deniedTool,
              } as ActivityMessage,
            });
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
    }

    return results;
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
            const converted = this.convertJsonlEntry(entry, instance.watchState.pendingTools);
            for (const histEntry of converted) {
              this.pushHistory(instance, histEntry.message);
              instance.info.lastActivityAt = Date.now();

              const msg = histEntry.message;
              if (msg.type === "output") {
                const output = msg as OutputMessage;
                if (output.isWaiting) {
                  instance.info.waitingForInput = true;
                  this.setStatus(instance, "idle");
                } else {
                  this.setStatus(instance, "processing");
                }
                this.emit("instance:output", instanceId, output);
              } else if (msg.type === "activity") {
                this.setStatus(instance, "processing");
                this.emit("instance:activity", instanceId, msg as ActivityMessage);
              } else if (msg.type === "user") {
                instance.info.waitingForInput = false;
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
  // Instance persistence (manifest)
  // ===========================================================================

  private loadManifest(): ManifestEntry[] {
    const filePath = this.baseConfig.manifestFile;
    try {
      const data = readFileSync(filePath, "utf-8");
      return JSON.parse(data);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return []; // First run — no manifest yet
      }
      this.baseConfig.logger.warn(`[InstanceManager] Failed to load manifest: ${err}`);
      return [];
    }
  }

  private saveManifest(): void {
    const filePath = this.baseConfig.manifestFile;
    const entries: ManifestEntry[] = [];

    for (const [, instance] of this.instances) {
      if (instance.info.external || !instance.sessionId) continue;
      entries.push({
        id: instance.info.id,
        name: instance.info.name,
        workingDirectory: instance.info.workingDirectory,
        sessionId: instance.sessionId,
        jsonlPath: instance.jsonlPath!,
        dangerouslySkipPermissions: this.baseConfig.dangerouslySkipPermissions,
        createdAt: instance.info.createdAt,
      });
    }

    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(entries, null, 2), "utf-8");
    } catch (err: unknown) {
      this.baseConfig.logger.warn(`[InstanceManager] Failed to save manifest: ${err}`);
    }
  }

  restoreInstances(): void {
    const entries = this.loadManifest();
    if (entries.length === 0) return;

    let restored = 0;
    for (const entry of entries) {
      if (!existsSync(entry.jsonlPath)) {
        this.baseConfig.logger.debug(
          `[InstanceManager] Skipping stale manifest entry "${entry.name}" — JSONL not found`
        );
        continue;
      }

      if (this.instances.size >= this.baseConfig.maxInstances) {
        this.baseConfig.logger.warn(
          `[InstanceManager] Max instances reached, skipping remaining manifest entries`
        );
        break;
      }

      // Parse JSONL to recover history
      const { history } = this.parseJsonl(entry.jsonlPath);

      // Create a ClaudeProcess that resumes the session
      const instanceConfig: CoreConfig = {
        ...this.baseConfig,
        workingDirectory: entry.workingDirectory,
        dangerouslySkipPermissions: entry.dangerouslySkipPermissions,
      };

      const proc = new ClaudeProcess(instanceConfig, { resumeSessionId: entry.sessionId });

      const info: InstanceInfo = {
        id: entry.id,
        name: entry.name,
        workingDirectory: entry.workingDirectory,
        status: "idle",
        createdAt: entry.createdAt,
        lastActivityAt: Date.now(),
      };

      // Recover lastMessage from history
      for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i].message;
        if (msg.type === "user" && (msg as UserMessage).text) {
          info.lastMessage = { text: (msg as UserMessage).text, from: "user", timestamp: history[i].timestamp };
          break;
        } else if (msg.type === "output") {
          const output = msg as OutputMessage;
          if (output.text && output.text.trim() && !output.isWaiting) {
            info.lastMessage = { text: output.text, from: "claude", timestamp: history[i].timestamp };
            break;
          }
        }
      }

      // Set up JSONL watching so terminal-side changes are picked up
      let watchState: WatchState | undefined;
      try {
        watchState = {
          jsonlPath: entry.jsonlPath,
          fileOffset: statSync(entry.jsonlPath).size,
          pendingTools: new Map(),
        };
      } catch {
        // ignore — file stat failure handled by startWatching guard
      }

      const instance: Instance = {
        info,
        process: proc,
        history,
        sessionId: entry.sessionId,
        jsonlPath: entry.jsonlPath,
        watchState,
      };

      this.instances.set(entry.id, instance);
      this.wireProcessEvents(entry.id, instance, proc);
      this.startWatching(entry.id, instance);

      this.emit("instance:created", entry.id, { ...info });
      restored++;
    }

    if (restored > 0) {
      this.baseConfig.logger.info(`[InstanceManager] Restored ${restored} instance(s) from manifest`);
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
        instance.info.waitingForInput = true;
        this.setStatus(instance, "idle");
      } else {
        this.setStatus(instance, "processing");
      }

      this.emit("instance:output", id, message);
    });

    proc.on("activity", (message) => {
      this.pushHistory(instance, message);
      instance.info.lastActivityAt = Date.now();
      this.setStatus(instance, "processing");
      this.emit("instance:activity", id, message);
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

      const cwd = instance.info.workingDirectory;
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
            instance.watchState = {
              jsonlPath: newestJsonl.path,
              fileOffset: statSync(newestJsonl.path).size,
              pendingTools: new Map(),
            };
            this.startWatching(id, instance);
          } catch {
            // ignore — file may have been removed between checks
          }
        }

        this.saveManifest();

        this.baseConfig.logger.debug(
          `[InstanceManager] Captured session ID "${sessionId}" for instance "${instance.info.name}"`
        );
      } catch (err) {
        this.baseConfig.logger.debug(
          `[InstanceManager] Failed to capture session ID for "${instance.info.name}": ${err}`
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
    history: HistoryEntry[]
  ): string | null {
    // Try sessions-index.json summary
    const encoded = cwd.replace(/\//g, "-");
    const indexPath = join(this.claudeDir, "projects", encoded, "sessions-index.json");
    try {
      const indexData = JSON.parse(readFileSync(indexPath, "utf-8"));
      if (indexData.entries && Array.isArray(indexData.entries)) {
        const entry = indexData.entries.find(
          (e: { sessionId?: string }) => e.sessionId === sessionId
        );
        if (entry?.summary) return entry.summary;
      }
    } catch {
      // no index or parse error
    }

    // Fall back to first user message
    for (const h of history) {
      if (h.message.type === "user" && (h.message as UserMessage).text) {
        return generateTitle((h.message as UserMessage).text);
      }
    }

    return null;
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
