/**
 * Codex CLI Session Provider
 *
 * Wraps `codex exec --json` / `codex exec resume --json` to implement
 * the ProviderSession interface for relay-managed Codex sessions.
 */

import { EventEmitter } from "events";
import { spawn, execSync, type ChildProcess } from "child_process";
import type { Readable } from "stream";
import type {
  OutputMessage,
  ExitMessage,
  ActivityMessage,
  FileChange,
  SessionStats,
  ProviderRequest,
  ProviderRuntimeBinding,
} from "../types.js";
import type { CoreConfig } from "../config.js";
import type { ProviderSession } from "../provider.js";

type SpawnFn = typeof spawn;

interface CodexStreamEvent {
  type: string;
  thread_id?: string;
  item?: {
    id?: string;
    type?: string;
    name?: string;
    text?: string;
    input?: string;
    output?: string;
    command?: string;
    aggregated_output?: string;
    exit_code?: number | null;
    status?: string;
  };
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
  };
}

export interface CodexCliSessionOptions {
  cwd: string;
  model?: string;
  resumeSessionId?: string;
  dangerouslySkipPermissions?: boolean;
  logger: CoreConfig["logger"];
  processTimeout?: number;
  spawnProcess?: SpawnFn;
  codexPath?: string;
}

function trackFileChange(files: Map<string, FileChange>, path: string, type: "added" | "edited") {
  const existing = files.get(path);
  if (existing) {
    existing.editCount++;
    if (existing.type !== "added") existing.type = type;
    return;
  }
  files.set(path, { path, editCount: 1, type });
}

function extractPatchFiles(patch: string): Array<{ path: string; type: "added" | "edited" }> {
  const files = new Map<string, { path: string; type: "added" | "edited" }>();
  let pendingPath: string | null = null;
  let pendingType: "added" | "edited" = "edited";

  for (const rawLine of patch.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith("*** Add File: ")) {
      pendingPath = line.slice("*** Add File: ".length).trim();
      pendingType = "added";
      files.set(pendingPath, { path: pendingPath, type: pendingType });
      continue;
    }
    if (line.startsWith("*** Update File: ")) {
      pendingPath = line.slice("*** Update File: ".length).trim();
      pendingType = "edited";
      files.set(pendingPath, { path: pendingPath, type: pendingType });
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      pendingPath = line.slice("*** Delete File: ".length).trim();
      pendingType = "edited";
      files.set(pendingPath, { path: pendingPath, type: pendingType });
      continue;
    }
    if (line.startsWith("*** Move to: ") && pendingPath) {
      const movedPath = line.slice("*** Move to: ".length).trim();
      files.delete(pendingPath);
      pendingPath = movedPath;
      files.set(movedPath, { path: movedPath, type: pendingType });
    }
  }

  return Array.from(files.values());
}

export class CodexCliSession extends EventEmitter implements ProviderSession {
  private currentProcess: ChildProcess | null = null;
  private readonly logger: CoreConfig["logger"];
  private readonly cwd: string;
  private readonly processTimeout: number;
  private readonly spawnProcess: SpawnFn;
  private readonly codexPath: string;
  private _isProcessing = false;
  private _sessionId: string | undefined;
  private _preferredModel: string | null;
  private _bypassPermissions: boolean;
  private _stats: SessionStats = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUSD: 0,
  };
  private readonly fileMap = new Map<string, FileChange>();
  private readonly pendingCustomToolCalls = new Map<string, { name: string; input?: string }>();
  private stderrBuffer = "";
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(options: CodexCliSessionOptions) {
    super();
    this.logger = options.logger;
    this.cwd = options.cwd;
    this.processTimeout = options.processTimeout ?? 0;
    this.spawnProcess = options.spawnProcess ?? spawn;

    const resolved = options.codexPath ?? findCodexBinary();
    if (!resolved) {
      throw new Error(
        "Codex CLI not found. Install it with: npm install -g @openai/codex" +
          "\nSee https://github.com/openai/codex for details.",
      );
    }
    this.codexPath = resolved;

    this._sessionId = options.resumeSessionId;
    this._preferredModel = options.model ?? null;
    this._bypassPermissions = options.dangerouslySkipPermissions ?? false;
  }

  get isProcessing(): boolean {
    return this._isProcessing;
  }

  get provider(): "codex" {
    return "codex";
  }

  get pid(): number | undefined {
    return this.currentProcess?.pid;
  }

  get stats(): SessionStats {
    return { ...this._stats };
  }

  getRuntimeBinding(): ProviderRuntimeBinding {
    return {
      provider: "codex",
      providerSessionId: this._sessionId,
      resumeCursor: this._sessionId ? { sessionId: this._sessionId } : undefined,
      runtimePayload: {
        cwd: this.cwd,
        model: this._preferredModel ?? undefined,
      },
      runtimeMode: this._bypassPermissions ? "full-access" : "approval-required",
    };
  }

  send(message: string): void {
    if (this._isProcessing) {
      this.logger.warn("[CodexCliSession] Already processing, ignoring message");
      return;
    }

    this._isProcessing = true;
    this.stderrBuffer = "";

    const args = this.buildArgs(message);
    this.logger.info(`[CodexCliSession] Running: ${this.codexPath} ${args.join(" ")}`);

    this.currentProcess = this.spawnProcess(this.codexPath, args, {
      cwd: this.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.wireStdout(this.currentProcess.stdout);
    this.wireStderr(this.currentProcess.stderr);
    this.wireLifecycle(this.currentProcess);
    this.resetTimeout();
  }

  interrupt(): void {
    if (!this.currentProcess) return;
    this.logger.info("[CodexCliSession] Interrupting...");
    this.currentProcess.kill("SIGINT");
  }

  close(): void {
    this.clearTimeout();
    if (!this.currentProcess) return;
    this.currentProcess.kill("SIGKILL");
    this.currentProcess = null;
    this._isProcessing = false;
  }

  addAllowedTool(_tool: string): void {
    // Codex CLI exec mode does not currently expose a request/approval
    // channel we can route through ProviderRequest. Keep the method as a no-op
    // so the provider fits the shared interface.
  }

  setModel(model: string | null): void {
    this._preferredModel = model;
  }

  setReasoningBudget(_budget: number | null): void {
    // Codex CLI exec does not currently expose a direct "reasoning budget" flag.
  }

  setBypassPermissions(bypass: boolean): void {
    this._bypassPermissions = bypass;
  }

  respondToRequest(_requestId: string, _decision: "accept" | "decline"): boolean {
    return false;
  }

  private buildArgs(message: string): string[] {
    const args = ["exec"];
    if (this._sessionId) {
      args.push("resume", this._sessionId);
    }

    args.push("--json", "--skip-git-repo-check");

    if (this._preferredModel) {
      args.push("-m", this._preferredModel);
    }

    if (this._bypassPermissions) {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    } else {
      args.push("-a", "never", "-s", "workspace-write");
    }

    args.push(message);
    return args;
  }

  private wireStdout(stream: Readable | null): void {
    if (!stream) return;
    let buffer = "";
    stream.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) this.handleLine(line);
        newlineIndex = buffer.indexOf("\n");
      }
    });
  }

  private wireStderr(stream: Readable | null): void {
    if (!stream) return;
    stream.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      this.stderrBuffer += text;
      if (this.stderrBuffer.length > 4000) {
        this.stderrBuffer = this.stderrBuffer.slice(-4000);
      }
      this.logger.debug(`[CodexCliSession] stderr: ${text.trim()}`);
    });
  }

  private wireLifecycle(child: ChildProcess): void {
    child.on("close", (code, signal) => {
      this.clearTimeout();
      const wasProcessing = this._isProcessing;
      this.currentProcess = null;
      if (wasProcessing) {
        this.finishTurn();
      }

      if (code !== 0 || signal) {
        const exit: ExitMessage = {
          type: "exit",
          code: code ?? 1,
          signal: signal ?? undefined,
          stderr: this.stderrBuffer.trim() || undefined,
        };
        this.emit("exit", exit);
      }
    });

    child.on("error", (err) => {
      this.clearTimeout();
      this.currentProcess = null;
      this._isProcessing = false;
      this.emit("exit", {
        type: "exit",
        code: 1,
        stderr: String(err),
      });
    });
  }

  private handleLine(line: string): void {
    let event: CodexStreamEvent;
    try {
      event = JSON.parse(line) as CodexStreamEvent;
    } catch {
      const output: OutputMessage = {
        type: "output",
        text: `${line}\n`,
        isWaiting: false,
      };
      this.emit("output", output);
      return;
    }

    switch (event.type) {
      case "thread.started":
        if (event.thread_id) {
          this._sessionId = event.thread_id;
        }
        break;

      case "item.started":
        this.handleItemStarted(event.item);
        break;

      case "item.completed":
        this.handleItemCompleted(event.item);
        break;

      case "turn.completed":
        if (event.usage) {
          const inputTokens = event.usage.input_tokens ?? 0;
          const cacheReadTokens = event.usage.cached_input_tokens ?? 0;
          this._stats.inputTokens += inputTokens;
          this._stats.cacheReadTokens += cacheReadTokens;
          this._stats.outputTokens += event.usage.output_tokens ?? 0;
          // Codex reports cached tokens as a subset of input_tokens, so do not double-count them.
          this._stats.contextTokens = inputTokens;
          this.emit("stats", { ...this._stats });
        }
        this.finishTurn();
        break;

      default:
        this.logger.debug(`[CodexCliSession] event: ${event.type}`);
        break;
    }
  }

  private handleItemStarted(item: CodexStreamEvent["item"]): void {
    if (!item) return;
    if (item.type === "command_execution" && item.command) {
      const activity: ActivityMessage = {
        type: "activity",
        activity: "tool_use",
        tool: "Bash",
        description: `Running command: ${item.command}`,
        detail: item.command,
        input: { command: item.command },
        inputDescription: item.command,
      };
      this.emit("activity", activity);
      return;
    }

    if (item.type === "custom_tool_call" && item.name) {
      if (item.id) {
        this.pendingCustomToolCalls.set(item.id, {
          name: item.name,
          input: typeof item.input === "string" ? item.input : undefined,
        });
      }
      const activity: ActivityMessage = {
        type: "activity",
        activity: "tool_use",
        tool: item.name,
        description: item.name === "apply_patch" ? "Editing files" : `Using ${item.name}`,
        detail:
          item.name === "apply_patch"
            ? undefined
            : typeof item.input === "string"
              ? item.input
              : undefined,
      };
      this.emit("activity", activity);
    }
  }

  private handleItemCompleted(item: CodexStreamEvent["item"]): void {
    if (!item) return;

    if (item.type === "agent_message" && item.text) {
      const output: OutputMessage = {
        type: "output",
        text: item.text,
        isWaiting: false,
      };
      this.emit("output", output);
      return;
    }

    if (item.type === "command_execution" && item.command) {
      const outputText = item.aggregated_output?.trim();
      const status =
        item.exit_code === 0 || item.status === "completed"
          ? "Command completed"
          : "Command failed";
      const activity: ActivityMessage = {
        type: "activity",
        activity: "tool_result",
        tool: "Bash",
        description: status,
        detail: outputText || item.command,
        input: { command: item.command, exitCode: item.exit_code ?? undefined },
        inputDescription: item.command,
      };
      this.emit("activity", activity);
      return;
    }

    const pendingCall = item.id ? this.pendingCustomToolCalls.get(item.id) : undefined;
    const toolName = item.name ?? pendingCall?.name;
    const toolInput =
      typeof item.input === "string"
        ? item.input
        : typeof pendingCall?.input === "string"
          ? pendingCall.input
          : undefined;
    if (item.id) {
      this.pendingCustomToolCalls.delete(item.id);
    }

    if ((item.type === "custom_tool_call" || item.type === "custom_tool_call_output") && toolName) {
      if (toolName === "apply_patch" && toolInput) {
        for (const file of extractPatchFiles(toolInput)) {
          trackFileChange(this.fileMap, file.path, file.type);
        }
        if (this.fileMap.size > 0) {
          this.emit("activity", {
            type: "activity",
            activity: "file_list",
            description: "Files changed",
            files: Array.from(this.fileMap.values()).map((file) => ({ ...file })),
          });
        }
      }

      const detail =
        typeof item.output === "string"
          ? item.output.trim() || undefined
          : toolName === "apply_patch"
            ? "Patch applied"
            : undefined;
      this.emit("activity", {
        type: "activity",
        activity: "tool_result",
        tool: toolName,
        description: "Tool completed",
        detail,
      });
    }
  }

  private finishTurn(): void {
    if (!this._isProcessing) return;
    this.clearTimeout();
    this._isProcessing = false;
    const done: OutputMessage = {
      type: "output",
      text: "",
      isWaiting: true,
    };
    this.emit("output", done);
  }

  private resetTimeout(): void {
    this.clearTimeout();
    if (this.processTimeout <= 0) return;
    this.timeoutHandle = setTimeout(() => {
      if (!this.currentProcess) return;
      this.logger.warn(`[CodexCliSession] Timeout after ${this.processTimeout}ms`);
      this.currentProcess.kill("SIGKILL");
    }, this.processTimeout);
  }

  private clearTimeout(): void {
    if (!this.timeoutHandle) return;
    clearTimeout(this.timeoutHandle);
    this.timeoutHandle = null;
  }
}

export function findCodexBinary(): string | null {
  const candidates = [
    `${process.env.HOME}/.local/bin/codex`,
    "/usr/local/bin/codex",
    "/opt/homebrew/bin/codex",
  ];

  for (const candidate of candidates) {
    try {
      if (execSync(`test -x "${candidate}" && echo ok`, { encoding: "utf-8" }).trim() === "ok") {
        return candidate;
      }
    } catch {
      // ignore and continue
    }
  }

  try {
    const result = execSync("which codex", { encoding: "utf-8" }).trim();
    if (result) return result;
  } catch {
    // ignore
  }

  return null;
}

export function isCodexInstalled(): boolean {
  return findCodexBinary() !== null;
}
