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
  statSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import { ClaudeProcess } from "./claude-process.js";
import type { RelayConfig } from "./config.js";
import type {
  ServerMessage,
  OutputMessage,
  ExitMessage,
  ActivityMessage,
  UserMessage,
} from "./types.js";
import { describeToolUse, describeToolDetail } from "./tools.js";

// =============================================================================
// Types
// =============================================================================

export type InstanceStatus = "idle" | "processing" | "error" | "stopped";

export interface InstanceInfo {
  id: string;
  name: string;
  workingDirectory: string;
  status: InstanceStatus;
  createdAt: number;
  lastActivityAt: number;
  /** True for discovered external Claude sessions (read-only) */
  external?: boolean;
}

export interface HistoryEntry {
  timestamp: number;
  message: ServerMessage;
}

interface ExternalState {
  jsonlPath: string;
  fileOffset: number;
  sessionId: string;
}

interface Instance {
  info: InstanceInfo;
  process: ClaudeProcess | null;
  history: HistoryEntry[];
  externalState?: ExternalState;
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

export class InstanceManager extends EventEmitter {
  private instances = new Map<string, Instance>();
  private baseConfig: RelayConfig;
  private instanceCounter = 0;
  private discoveryInterval: ReturnType<typeof setInterval> | null = null;
  private watchIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private claudeDir = join(homedir(), ".claude");

  constructor(config: RelayConfig) {
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

    const instanceConfig: RelayConfig = {
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

    const instance: Instance = { info, process: proc, history: [] };
    this.instances.set(id, instance);

    // Wire up events
    proc.on("output", (message) => {
      this.pushHistory(instance, message);
      info.lastActivityAt = Date.now();

      if (message.isWaiting) {
        this.setStatus(instance, "idle");
      } else {
        this.setStatus(instance, "processing");
      }

      this.emit("instance:output", id, message);
    });

    proc.on("activity", (message) => {
      this.pushHistory(instance, message);
      info.lastActivityAt = Date.now();
      this.setStatus(instance, "processing");
      this.emit("instance:activity", id, message);
    });

    proc.on("exit", (message) => {
      this.pushHistory(instance, message);
      info.lastActivityAt = Date.now();
      if (message.code !== 0) {
        this.setStatus(instance, "error");
      }
      this.emit("instance:exit", id, message);
    });

    this.baseConfig.logger.info(`[InstanceManager] Created instance "${name}" (${id})`);
    return { ...info };
  }

  removeInstance(id: string): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;

    if (instance.process) {
      instance.process.kill();
    }

    // Stop JSONL watcher if external
    const watchInterval = this.watchIntervals.get(id);
    if (watchInterval) {
      clearInterval(watchInterval);
      this.watchIntervals.delete(id);
    }

    instance.info.status = "stopped";
    this.instances.delete(id);
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

    // Store user message in history so replay works across devices
    const userMessage: UserMessage = { type: "user", text, instanceId: id };
    this.pushHistory(instance, userMessage);

    // Immediately reflect processing status
    instance.info.lastActivityAt = Date.now();
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
   * Resume an external session — converts it from read-only monitoring
   * to an interactive managed instance using `claude -p --resume <sessionId>`.
   */
  resumeInstance(id: string): InstanceInfo {
    const instance = this.instances.get(id);
    if (!instance) throw new Error(`Instance ${id} not found`);
    if (!instance.externalState) throw new Error("Instance is not an external session");

    const sessionId = instance.externalState.sessionId;
    const cwd = instance.info.workingDirectory;

    // Stop the JSONL watcher
    const watchInterval = this.watchIntervals.get(id);
    if (watchInterval) {
      clearInterval(watchInterval);
      this.watchIntervals.delete(id);
    }

    // Create a ClaudeProcess that resumes the session
    const instanceConfig: RelayConfig = {
      ...this.baseConfig,
      workingDirectory: cwd,
    };

    const proc = new ClaudeProcess(instanceConfig, { resumeSessionId: sessionId });

    // Convert from external to managed
    instance.process = proc;
    instance.info.external = false;
    delete instance.externalState;

    // Wire up events (same as createInstance)
    proc.on("output", (message) => {
      this.pushHistory(instance, message);
      instance.info.lastActivityAt = Date.now();
      if (message.isWaiting) {
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

    this.setStatus(instance, "idle");
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

    // Track known external JSONL paths
    const knownJsonls = new Map<string, string>(); // jsonlPath → instanceId
    for (const [instanceId, instance] of this.instances) {
      if (instance.externalState) {
        knownJsonls.set(instance.externalState.jsonlPath, instanceId);
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
    const name = dirName;
    const now = Date.now();
    const lastActivity = history.length > 0 ? history[history.length - 1].timestamp : now;

    const info: InstanceInfo = {
      id,
      name,
      workingDirectory: cwd,
      status: "idle",
      createdAt: lastActivity,
      lastActivityAt: lastActivity,
      external: true,
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

      for (const line of tailContent.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          // Also grab metadata from tail lines in case head didn't have it
          if (!cwd && entry.cwd) cwd = entry.cwd;
          if (!slug && entry.slug) slug = entry.slug;

          const converted = this.convertJsonlEntry(entry);
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
      content?: string | Array<{ type: string; text?: string; thinking?: string; name?: string; input?: Record<string, unknown>; is_error?: boolean; content?: string }>;
    };
  }): HistoryEntry[] {
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
      // Skip interrupt markers
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
            if (textParts.length > 0) {
              results.push({
                timestamp,
                message: {
                  type: "output",
                  text: textParts.join(""),
                  isWaiting: false,
                } as OutputMessage,
              });
              textParts = [];
            }
            results.push({
              timestamp,
              message: {
                type: "activity",
                activity: "tool_use",
                tool: block.name,
                description: describeToolUse(block.name || "Unknown"),
                detail: describeToolDetail(
                  block.name || "Unknown",
                  block.input
                ),
              } as ActivityMessage,
            });
          } else if (block.type === "tool_result") {
            results.push({
              timestamp,
              message: {
                type: "activity",
                activity: "tool_result",
                description: block.is_error ? "Tool error" : "Tool completed",
              } as ActivityMessage,
            });
          } else if (block.type === "text" && block.text) {
            textParts.push(block.text);
          }
        }

        // Flush remaining text
        if (textParts.length > 0) {
          results.push({
            timestamp,
            message: {
              type: "output",
              text: textParts.join(""),
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
    if (!instance.externalState) return;

    const interval = setInterval(() => {
      if (!instance.externalState) return;

      try {
        const stat = statSync(instance.externalState.jsonlPath);
        if (stat.size <= instance.externalState.fileOffset) return;

        // Read new bytes
        const fd = openSync(instance.externalState.jsonlPath, "r");
        let newContent: string;
        try {
          const buf = Buffer.alloc(stat.size - instance.externalState.fileOffset);
          readSync(fd, buf, 0, buf.length, instance.externalState.fileOffset);
          newContent = buf.toString("utf-8");
        } finally {
          closeSync(fd);
        }

        instance.externalState.fileOffset = stat.size;

        for (const line of newContent.split("\n")) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            const converted = this.convertJsonlEntry(entry);
            for (const histEntry of converted) {
              this.pushHistory(instance, histEntry.message);
              instance.info.lastActivityAt = Date.now();

              const msg = histEntry.message;
              if (msg.type === "output") {
                const output = msg as OutputMessage;
                if (output.isWaiting) {
                  this.setStatus(instance, "idle");
                } else {
                  this.setStatus(instance, "processing");
                }
                this.emit("instance:output", instanceId, output);
              } else if (msg.type === "activity") {
                this.setStatus(instance, "processing");
                this.emit("instance:activity", instanceId, msg as ActivityMessage);
              } else if (msg.type === "user") {
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
  // Internal helpers
  // ===========================================================================

  private setStatus(instance: Instance, status: InstanceStatus): void {
    if (instance.info.status === status) return;
    instance.info.status = status;
    this.emit("instance:status", instance.info.id, { ...instance.info });
  }

  private pushHistory(instance: Instance, message: ServerMessage): void {
    instance.history.push({ timestamp: Date.now(), message });
    if (instance.history.length > MAX_HISTORY) {
      instance.history.splice(0, instance.history.length - MAX_HISTORY);
    }
  }
}

