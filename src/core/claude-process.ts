/**
 * Claude Process Manager
 *
 * Manages Claude Code using print mode (-p) for clean text output.
 * Each message spawns a new process with --continue to maintain conversation context.
 */

import { EventEmitter } from "events";
import { spawn, execSync, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import type { OutputMessage, ExitMessage, ActivityMessage } from "./types.js";
import type { CoreConfig } from "./config.js";
import { describeToolUse, describeToolDetail, isPermissionDenial } from "./tools.js";

// =============================================================================
// Types
// =============================================================================

export interface ClaudeProcessEvents {
  output: [OutputMessage];
  exit: [ExitMessage];
  activity: [ActivityMessage];
}

export interface ClaudeProcess {
  on<E extends keyof ClaudeProcessEvents>(
    event: E,
    listener: (...args: ClaudeProcessEvents[E]) => void
  ): this;
  emit<E extends keyof ClaudeProcessEvents>(
    event: E,
    ...args: ClaudeProcessEvents[E]
  ): boolean;
  off<E extends keyof ClaudeProcessEvents>(
    event: E,
    listener: (...args: ClaudeProcessEvents[E]) => void
  ): this;
}

// =============================================================================
// ClaudeProcess Class
// =============================================================================

/**
 * Manages Claude Code using print mode for clean output.
 */
export class ClaudeProcess extends EventEmitter {
  private currentProcess: ChildProcess | null = null;
  private _isProcessing = false;
  private claudePath: string;
  private cwd: string;
  private isFirstMessage = true;
  private config: CoreConfig;
  private resumeSessionId: string | null;
  private allowedTools: string[] = [];

  constructor(config: CoreConfig, options?: { resumeSessionId?: string }) {
    super();
    this.config = config;
    this.resumeSessionId = options?.resumeSessionId ?? null;
    this.claudePath = this.findClaudeBinary();
    this.cwd = config.workingDirectory;
    config.logger.info(`[Claude] Binary: ${this.claudePath}`);
    config.logger.info(`[Claude] Working directory: ${this.cwd}`);
    if (this.resumeSessionId) {
      config.logger.info(`[Claude] Resuming session: ${this.resumeSessionId}`);
    }
  }

  get isProcessing(): boolean {
    return this._isProcessing;
  }

  /**
   * Set the session ID after it has been captured from the JSONL file.
   * Subsequent sends will use --resume <id> for precise session targeting
   * instead of --continue (which picks up the "last" session in the CWD).
   */
  setSessionId(sessionId: string): void {
    this.resumeSessionId = sessionId;
  }

  /**
   * Add a tool to the allowed list. Subsequent sends will include
   * --allowedTools with all accumulated tools. Deduplicates.
   */
  addAllowedTool(tool: string): void {
    if (!this.allowedTools.includes(tool)) {
      this.allowedTools.push(tool);
    }
  }

  private findClaudeBinary(): string {
    const commonPaths = [
      `${process.env.HOME}/.local/bin/claude`,
      "/usr/local/bin/claude",
      "/opt/homebrew/bin/claude",
    ];

    for (const p of commonPaths) {
      if (existsSync(p)) {
        return p;
      }
    }

    try {
      const result = execSync("which claude", { encoding: "utf-8" }).trim();
      if (result) return result;
    } catch {
      // ignore
    }

    return "claude";
  }

  /**
   * Send a message to Claude.
   */
  send(message: string): void {
    if (this._isProcessing) {
      this.config.logger.info("[Claude] Already processing, ignoring message");
      return;
    }

    this._isProcessing = true;
    this.config.logger.info(`[Claude] Sending: "${message.slice(0, 50)}..."`);

    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
    ];

    if (this.config.dangerouslySkipPermissions) {
      args.push("--dangerously-skip-permissions");
    }

    if (this.allowedTools.length > 0) {
      args.push("--allowedTools", this.allowedTools.join(" "));
    }

    if (this.resumeSessionId) {
      args.push("--resume", this.resumeSessionId);
    } else if (!this.isFirstMessage) {
      args.push("--continue");
    }

    args.push(message);

    this.config.logger.debug(`[Claude] Running: claude ${args.join(" ")}`);

    this.currentProcess = spawn(this.claudePath, args, {
      cwd: this.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.config.logger.debug(`[Claude] Process spawned with PID: ${this.currentProcess.pid}`);

    this.currentProcess.stdin?.end();

    let lineBuffer = "";
    let hasEmittedContent = false;
    // Map tool_use_id → tool name so tool_result denials know which tool was denied
    const pendingTools = new Map<string, string>();

    this.currentProcess.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      lineBuffer += chunk;

      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line);

          this.config.logger.debug(`[Claude] event: ${JSON.stringify(event).slice(0, 200)}`);

          if (event.type === "system") {
            this.config.logger.debug("[Claude] system init");
          } else if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "thinking" && block.thinking) {
                const activity: ActivityMessage = {
                  type: "activity",
                  activity: "thinking",
                  description: "Reasoning...",
                  detail: block.thinking.slice(0, 500) + (block.thinking.length > 500 ? "..." : ""),
                };
                this.emit("activity", activity);
                hasEmittedContent = true;
              } else if (block.type === "tool_use") {
                const toolName = block.name || "Unknown tool";
                if (block.id) pendingTools.set(block.id, toolName);
                const activity: ActivityMessage = {
                  type: "activity",
                  activity: "tool_use",
                  tool: toolName,
                  description: describeToolUse(toolName, block.input),
                  detail: describeToolDetail(toolName, block.input),
                  input: block.input as Record<string, unknown> | undefined,
                };
                this.emit("activity", activity);
              } else if (block.type === "text" && block.text) {
                const outputMessage: OutputMessage = {
                  type: "output",
                  text: block.text,
                  isWaiting: false,
                };
                this.emit("output", outputMessage);
                hasEmittedContent = true;
              }
            }
          } else if (event.type === "tool_use") {
            const toolName = event.name || event.tool || "Unknown tool";
            if (event.id) pendingTools.set(event.id, toolName);
            const activity: ActivityMessage = {
              type: "activity",
              activity: "tool_use",
              tool: toolName,
              description: describeToolUse(toolName, event.input),
              detail: describeToolDetail(toolName, event.input),
              input: event.input as Record<string, unknown> | undefined,
            };
            this.emit("activity", activity);
          } else if (event.type === "tool_result") {
            const content = event.content || "";
            const denied = event.is_error && isPermissionDenial(content);
            const deniedTool = denied ? (pendingTools.get(event.tool_use_id) || "Unknown") : undefined;
            const activity: ActivityMessage = {
              type: "activity",
              activity: "tool_result",
              description: deniedTool ? "Permission denied" : event.is_error ? "Tool error" : "Tool completed",
              tool: deniedTool,
              detail: content.slice(0, 200) || undefined,
              permissionDenied: deniedTool,
            };
            this.emit("activity", activity);
          } else if (event.type === "user" && event.message?.content) {
            // tool_result blocks arrive inside "user" type events in stream-json
            const content = event.message.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "tool_result") {
                  const text = block.content || "";
                  const denied = block.is_error && isPermissionDenial(text);
                  const deniedTool = denied ? (pendingTools.get(block.tool_use_id) || "Unknown") : undefined;
                  const activity: ActivityMessage = {
                    type: "activity",
                    activity: "tool_result",
                    description: deniedTool ? "Permission denied" : block.is_error ? "Tool error" : "Tool completed",
                    tool: deniedTool,
                    detail: text.slice(0, 200) || undefined,
                    permissionDenied: deniedTool,
                  };
                  this.emit("activity", activity);
                }
              }
            }
          } else if (event.type === "result") {
            this.config.logger.debug(`[Claude] result: success=${!event.is_error}`);
            if (!hasEmittedContent && event.result) {
              const outputMessage: OutputMessage = {
                type: "output",
                text: event.result,
                isWaiting: false,
              };
              this.emit("output", outputMessage);
            }
          } else {
            this.config.logger.debug(`[Claude] event: ${event.type}`);
          }
        } catch {
          this.config.logger.debug(`[Claude] raw text: "${line.slice(0, 50)}..."`);
          const outputMessage: OutputMessage = {
            type: "output",
            text: line + "\n",
            isWaiting: false,
          };
          this.emit("output", outputMessage);
        }
      }
    });

    this.currentProcess.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      this.config.logger.debug(`[Claude] stderr: "${text.slice(0, 100).replace(/\n/g, "\\n")}..."`);
    });

    this.currentProcess.on("close", (code) => {
      this.config.logger.info(`[Claude] Process exited with code: ${code}`);
      this._isProcessing = false;
      this.currentProcess = null;
      this.isFirstMessage = false;

      const doneMessage: OutputMessage = {
        type: "output",
        text: "",
        isWaiting: true,
      };
      this.emit("output", doneMessage);

      if (code !== 0) {
        const exitMessage: ExitMessage = {
          type: "exit",
          code: code || 1,
        };
        this.emit("exit", exitMessage);
      }
    });

    this.currentProcess.on("error", (err) => {
      this.config.logger.error("[Claude] Process error:", err);
      this._isProcessing = false;
      this.currentProcess = null;
    });

    // Timeout protection
    if (this.config.processTimeout > 0) {
      setTimeout(() => {
        if (this._isProcessing && this.currentProcess) {
          this.config.logger.warn(
            `[Claude] Process timeout after ${this.config.processTimeout}ms, killing...`
          );
          this.currentProcess.kill("SIGKILL");
          this._isProcessing = false;
          this.currentProcess = null;
        }
      }, this.config.processTimeout);
    }
  }

  /**
   * Cancel the current operation (SIGINT).
   */
  cancel(): void {
    if (this.currentProcess) {
      this.config.logger.info("[Claude] Cancelling...");
      this.currentProcess.kill("SIGINT");
      this._isProcessing = false;
      this.currentProcess = null;
    }
  }

  /**
   * Kill the process immediately (SIGKILL).
   */
  kill(): void {
    if (this.currentProcess) {
      this.currentProcess.kill("SIGKILL");
      this.currentProcess = null;
      this._isProcessing = false;
    }
  }
}
