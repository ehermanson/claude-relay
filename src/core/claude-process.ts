/**
 * Claude Process Manager
 *
 * Manages Claude Code using print mode (-p) for clean text output.
 * Each message spawns a new process with --continue to maintain conversation context.
 */

import { EventEmitter } from "events";
import { spawn, execSync, type ChildProcess } from "child_process";
import { existsSync } from "fs";
import type {
  OutputMessage,
  ExitMessage,
  ActivityMessage,
  TaskItem,
  FileChange,
  SessionStats,
  TeamInfo,
} from "./types.js";
import type { CoreConfig } from "./config.js";
import {
  describeToolUse,
  describeToolDetail,
  extractInputDescription,
  extractToolResultText,
  isPermissionDenial,
  estimateCost,
} from "./tools.js";

// =============================================================================
// Types
// =============================================================================

export interface ClaudeProcessEvents {
  output: [OutputMessage];
  exit: [ExitMessage];
  activity: [ActivityMessage];
  stats: [SessionStats];
}

export interface ClaudeProcess {
  on<E extends keyof ClaudeProcessEvents>(
    event: E,
    listener: (...args: ClaudeProcessEvents[E]) => void,
  ): this;
  emit<E extends keyof ClaudeProcessEvents>(event: E, ...args: ClaudeProcessEvents[E]): boolean;
  off<E extends keyof ClaudeProcessEvents>(
    event: E,
    listener: (...args: ClaudeProcessEvents[E]) => void,
  ): this;
}

const TASK_TOOLS = new Set(["TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TodoWrite"]);
const FILE_WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);

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
  private taskMap = new Map<string, TaskItem>();
  private pendingTaskCreates = new Map<string, { subject: string; activeForm?: string }>();
  private fileMap = new Map<string, FileChange>();
  private teamState: TeamInfo | null = null;
  private _cancelledForPermission = false;
  private _preferredModel: string | null = null;
  private _stats: SessionStats = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUSD: 0,
  };

  get stats(): SessionStats {
    return { ...this._stats };
  }

  constructor(config: CoreConfig, options?: { resumeSessionId?: string; model?: string }) {
    super();
    this.config = config;
    this.resumeSessionId = options?.resumeSessionId ?? null;
    this._preferredModel = options?.model ?? null;
    this.claudePath = this.findClaudeBinary();
    this.cwd = config.workingDirectory;
    config.logger.debug(`[Claude] Binary: ${this.claudePath}`);
    config.logger.debug(`[Claude] Working directory: ${this.cwd}`);
    if (this.resumeSessionId) {
      config.logger.debug(`[Claude] Resuming session: ${this.resumeSessionId}`);
    }
  }

  get isProcessing(): boolean {
    return this._isProcessing;
  }

  /** PID of the currently running child process, or undefined if idle */
  get pid(): number | undefined {
    return this.currentProcess?.pid;
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

  /**
   * Set the preferred model for subsequent sends. Pass null to clear.
   */
  setModel(model: string | null): void {
    this._preferredModel = model;
  }

  /**
   * Cancel the process due to a permission denial. Sends SIGINT but lets
   * the close handler manage _isProcessing cleanup to avoid races.
   */
  cancelForPermission(): void {
    if (this.currentProcess) {
      this._cancelledForPermission = true;
      this.config.logger.info("[Claude] Cancelling for permission denial");
      this.currentProcess.kill("SIGINT");
    }
  }

  /**
   * Apply a TodoWrite tool payload — replaces the entire task list.
   * TodoWrite sends all todos at once (unlike TaskCreate/TaskUpdate which are incremental).
   */
  private applyTodoWrite(input: Record<string, unknown>): void {
    const todos = input.todos as
      | Array<{ content?: string; status?: string; activeForm?: string }>
      | undefined;
    if (!Array.isArray(todos)) return;
    this.taskMap.clear();
    for (let i = 0; i < todos.length; i++) {
      const t = todos[i];
      if (!t.content) continue;
      const id = `todo-${i}`;
      this.taskMap.set(id, {
        id,
        subject: t.content,
        status: (t.status as TaskItem["status"]) || "pending",
        activeForm: t.activeForm,
      });
    }
    this.emitTaskList();
  }

  private emitTaskList(): void {
    const activity: ActivityMessage = {
      type: "activity",
      activity: "task_list",
      description: "Tasks",
      tasks: Array.from(this.taskMap.values()).map((t) => ({ ...t })),
    };
    this.emit("activity", activity);
  }

  private trackFileChange(toolName: string, input: Record<string, unknown> | undefined): void {
    if (!input || !FILE_WRITE_TOOLS.has(toolName)) return;
    const filePath = (input.file_path || input.path || input.notebook_path) as string | undefined;
    if (!filePath) return;
    const existing = this.fileMap.get(filePath);
    if (existing) {
      existing.editCount++;
    } else {
      this.fileMap.set(filePath, {
        path: filePath,
        editCount: 1,
        type: toolName === "Write" ? "added" : "edited",
      });
    }
    this.emitFileList();
  }

  private emitFileList(): void {
    const activity: ActivityMessage = {
      type: "activity",
      activity: "file_list",
      description: "Files changed",
      files: Array.from(this.fileMap.values()).map((f) => ({ ...f })),
    };
    this.emit("activity", activity);
  }

  private emitTeamInfo(): void {
    if (!this.teamState) return;
    const activity: ActivityMessage = {
      type: "activity",
      activity: "team_info",
      description: "Team",
      team: { ...this.teamState, members: this.teamState.members.map((m) => ({ ...m })) },
    };
    this.emit("activity", activity);
  }

  /**
   * Handle team-related tools. Returns true if the tool was handled and should
   * be suppressed from the normal tool_use activity stream.
   */
  private handleTeamTool(toolName: string, input: Record<string, unknown> | undefined): boolean {
    if (!input) return false;

    if (toolName === "TeamCreate") {
      this.teamState = {
        name: (input.team_name as string) || "team",
        description: input.description as string | undefined,
        members: [],
      };
      this.emitTeamInfo();
      return true;
    }

    if (toolName === "Task" && input.team_name && this.teamState) {
      this.teamState.members.push({
        name: (input.name as string) || "agent",
        subagentType: (input.subagent_type as string) || "agent",
        description: (input.description as string) || "",
        status: "running",
        spawnedAt: Date.now(),
      });
      this.emitTeamInfo();
      return true;
    }

    if (toolName === "SendMessage" && input.type === "shutdown_request" && this.teamState) {
      const recipient = input.recipient as string | undefined;
      if (recipient) {
        const member = this.teamState.members.find((m) => m.name === recipient);
        if (member) {
          member.status = "shutting_down";
          this.emitTeamInfo();
        }
      }
      return false; // Still show SendMessage as activity
    }

    if (toolName === "TeamDelete" && this.teamState) {
      for (const member of this.teamState.members) {
        member.status = "shutdown";
      }
      this.emitTeamInfo();
      return true;
    }

    return false;
  }

  private accumulateUsage(
    model: string,
    usage: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    },
  ): void {
    if (!usage.input_tokens && !usage.output_tokens) return;
    const u = {
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens,
    };
    this._stats.inputTokens += u.input_tokens;
    this._stats.outputTokens += u.output_tokens;
    this._stats.cacheCreationTokens += u.cache_creation_input_tokens ?? 0;
    this._stats.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    this._stats.costUSD += estimateCost(model, u);
    this._stats.model = model;
    this.emit("stats", { ...this._stats });
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
   * Images should be referenced in the message text as `[Image: source: /path]`
   * so Claude can read them via its Read tool.
   */
  send(message: string): void {
    if (this._isProcessing) {
      this.config.logger.info("[Claude] Already processing, ignoring message");
      return;
    }

    this._isProcessing = true;
    this.config.logger.info(`[Claude] Sending: "${message.slice(0, 50)}..."`);

    const args = ["-p", "--output-format", "stream-json", "--verbose"];

    if (this.config.dangerouslySkipPermissions) {
      args.push("--dangerously-skip-permissions");
    }

    if (this.allowedTools.length > 0) {
      args.push("--allowedTools", this.allowedTools.join(" "));
    }

    if (this._preferredModel) {
      args.push("--model", this._preferredModel);
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
                if (TASK_TOOLS.has(toolName)) {
                  const input = block.input as Record<string, unknown> | undefined;
                  if (toolName === "TodoWrite" && input) {
                    this.applyTodoWrite(input);
                  } else if (toolName === "TaskCreate" && input && block.id) {
                    this.pendingTaskCreates.set(block.id, {
                      subject: (input.subject as string) || "Untitled task",
                      activeForm: input.activeForm as string | undefined,
                    });
                  } else if (toolName === "TaskUpdate" && input) {
                    const taskId = input.taskId as string;
                    const status = input.status as string | undefined;
                    if (taskId && status === "deleted") {
                      this.taskMap.delete(taskId);
                      this.emitTaskList();
                    } else if (taskId && status && this.taskMap.has(taskId)) {
                      const task = this.taskMap.get(taskId)!;
                      task.status = status as TaskItem["status"];
                      if (input.subject) task.subject = input.subject as string;
                      if (input.activeForm) task.activeForm = input.activeForm as string;
                      this.emitTaskList();
                    }
                  }
                  // TaskList/TaskGet: suppress — no activity emitted
                } else if (
                  this.handleTeamTool(toolName, block.input as Record<string, unknown> | undefined)
                ) {
                  // Team tool handled — suppressed from chat
                } else {
                  this.trackFileChange(
                    toolName,
                    block.input as Record<string, unknown> | undefined,
                  );
                  const activity: ActivityMessage = {
                    type: "activity",
                    activity: "tool_use",
                    tool: toolName,
                    description: describeToolUse(toolName, block.input),
                    detail: describeToolDetail(toolName, block.input),
                    input: block.input as Record<string, unknown> | undefined,
                    inputDescription: extractInputDescription(toolName, block.input),
                  };
                  this.emit("activity", activity);
                }
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
            // Extract usage from assistant event
            if (event.message?.usage && event.message?.model) {
              this.accumulateUsage(event.message.model, event.message.usage);
            }
          } else if (event.type === "tool_use") {
            const toolName = event.name || event.tool || "Unknown tool";
            if (event.id) pendingTools.set(event.id, toolName);
            if (TASK_TOOLS.has(toolName)) {
              const input = event.input as Record<string, unknown> | undefined;
              if (toolName === "TodoWrite" && input) {
                this.applyTodoWrite(input);
              } else if (toolName === "TaskCreate" && input && event.id) {
                this.pendingTaskCreates.set(event.id, {
                  subject: (input.subject as string) || "Untitled task",
                  activeForm: input.activeForm as string | undefined,
                });
              } else if (toolName === "TaskUpdate" && input) {
                const taskId = input.taskId as string;
                const status = input.status as string | undefined;
                if (taskId && status === "deleted") {
                  this.taskMap.delete(taskId);
                  this.emitTaskList();
                } else if (taskId && status && this.taskMap.has(taskId)) {
                  const task = this.taskMap.get(taskId)!;
                  task.status = status as TaskItem["status"];
                  if (input.subject) task.subject = input.subject as string;
                  if (input.activeForm) task.activeForm = input.activeForm as string;
                  this.emitTaskList();
                }
              }
            } else if (
              this.handleTeamTool(toolName, event.input as Record<string, unknown> | undefined)
            ) {
              // Team tool handled — suppressed from chat
            } else {
              this.trackFileChange(toolName, event.input as Record<string, unknown> | undefined);
              const activity: ActivityMessage = {
                type: "activity",
                activity: "tool_use",
                tool: toolName,
                description: describeToolUse(toolName, event.input),
                detail: describeToolDetail(toolName, event.input),
                input: event.input as Record<string, unknown> | undefined,
                inputDescription: extractInputDescription(toolName, event.input),
              };
              this.emit("activity", activity);
            }
          } else if (event.type === "tool_result") {
            const toolName = pendingTools.get(event.tool_use_id);
            if (TASK_TOOLS.has(toolName || "")) {
              if (toolName === "TaskCreate") {
                const content = event.content || "";
                const idMatch = content.match(/Task #(\d+)/);
                const pending = this.pendingTaskCreates.get(event.tool_use_id);
                if (idMatch && pending) {
                  const taskId = idMatch[1];
                  this.taskMap.set(taskId, {
                    id: taskId,
                    subject: pending.subject,
                    status: "pending",
                    activeForm: pending.activeForm,
                  });
                  this.pendingTaskCreates.delete(event.tool_use_id);
                  this.emitTaskList();
                }
              }
              // Other task tool results: suppress
            } else {
              const content = extractToolResultText(event.content);
              const denied = event.is_error && isPermissionDenial(content);
              const deniedTool = denied
                ? pendingTools.get(event.tool_use_id) || "Unknown"
                : undefined;

              // Suppress duplicate denial emissions after cancel
              if (deniedTool && this._cancelledForPermission) continue;

              const activity: ActivityMessage = {
                type: "activity",
                activity: "tool_result",
                description: deniedTool
                  ? "Permission denied"
                  : event.is_error
                    ? "Tool error"
                    : "Tool completed",
                tool: deniedTool,
                detail: content.slice(0, 200) || undefined,
                permissionDenied: deniedTool,
              };
              this.emit("activity", activity);

              // Cancel process on first permission denial to stop retry loop
              if (deniedTool) {
                this.cancelForPermission();
              }
            }
          } else if (event.type === "user" && event.message?.content) {
            // tool_result blocks arrive inside "user" type events in stream-json
            const content = event.message.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "tool_result") {
                  const toolName = pendingTools.get(block.tool_use_id);
                  if (TASK_TOOLS.has(toolName || "")) {
                    if (toolName === "TaskCreate") {
                      const text = block.content || "";
                      const idMatch = text.match(/Task #(\d+)/);
                      const pending = this.pendingTaskCreates.get(block.tool_use_id);
                      if (idMatch && pending) {
                        const taskId = idMatch[1];
                        this.taskMap.set(taskId, {
                          id: taskId,
                          subject: pending.subject,
                          status: "pending",
                          activeForm: pending.activeForm,
                        });
                        this.pendingTaskCreates.delete(block.tool_use_id);
                        this.emitTaskList();
                      }
                    }
                  } else {
                    const text = extractToolResultText(block.content);
                    const denied = block.is_error && isPermissionDenial(text);
                    const deniedTool = denied
                      ? pendingTools.get(block.tool_use_id) || "Unknown"
                      : undefined;

                    // Suppress duplicate denial emissions after cancel
                    if (deniedTool && this._cancelledForPermission) continue;

                    const activity: ActivityMessage = {
                      type: "activity",
                      activity: "tool_result",
                      description: deniedTool
                        ? "Permission denied"
                        : block.is_error
                          ? "Tool error"
                          : "Tool completed",
                      tool: deniedTool,
                      detail: text.slice(0, 200) || undefined,
                      permissionDenied: deniedTool,
                    };
                    this.emit("activity", activity);

                    // Cancel process on first permission denial to stop retry loop
                    if (deniedTool) {
                      this.cancelForPermission();
                    }
                  }
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
            // Extract usage from result event
            if (event.usage && event.model) {
              this.accumulateUsage(event.model, event.usage);
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

    let stderrBuffer = "";
    this.currentProcess.stderr?.on("data", (data: Buffer) => {
      const text = data.toString();
      this.config.logger.debug(`[Claude] stderr: "${text.slice(0, 100).replace(/\n/g, "\\n")}..."`);
      stderrBuffer += text;
      if (stderrBuffer.length > 2000) {
        stderrBuffer = stderrBuffer.slice(-2000);
      }
    });

    this.currentProcess.on("close", (code, signal) => {
      this.config.logger.info(`[Claude] Process exited with code: ${code}, signal: ${signal}`);
      const wasCancelledForPermission = this._cancelledForPermission;
      this._cancelledForPermission = false;
      this._isProcessing = false;
      this.currentProcess = null;
      this.isFirstMessage = false;

      const doneMessage: OutputMessage = {
        type: "output",
        text: "",
        isWaiting: true,
      };
      this.emit("output", doneMessage);

      // Suppress error exit when we intentionally cancelled for permission denial
      if ((code !== 0 || signal) && !wasCancelledForPermission) {
        const trimmedStderr = stderrBuffer.trim().slice(-500) || undefined;
        const exitMessage: ExitMessage = {
          type: "exit",
          code: code ?? 1,
          signal: signal ?? undefined,
          stderr: trimmedStderr,
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
            `[Claude] Process timeout after ${this.config.processTimeout}ms, killing...`,
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
