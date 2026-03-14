/**
 * Codex App-Server Session Provider
 *
 * Wraps `codex app-server --listen stdio://` via a persistent JSON-RPC 2.0
 * connection. Replaces the process-per-message CLI approach with a long-lived
 * session using thread/start, thread/resume, and turn/start RPC methods.
 *
 * Key differences from CLI provider:
 * - Single long-lived process (no process churn per message)
 * - Streaming text via item/agentMessage/delta notifications
 * - Permission approval flow via requestApproval server requests
 * - Bidirectional RPC: thread/start, turn/start, turn/interrupt
 * - Token usage via thread/tokenUsage/updated notifications
 */

import { EventEmitter } from "events";
import { spawn, type ChildProcess } from "child_process";
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
import { buildTaskListActivityFromPlan } from "../tools.js";
import { findCodexBinary } from "./codex-cli.js";
import { getBuiltinProviderModels } from "../provider-catalog.js";

type SpawnFn = typeof spawn;

// =============================================================================
// JSON-RPC Types
// =============================================================================

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown;
}

interface JsonRpcResponse {
  jsonrpc?: "2.0";
  id?: number | string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc?: "2.0";
  method: string;
  params: unknown;
}

interface JsonRpcServerRequest {
  jsonrpc?: "2.0";
  id: number | string;
  method: string;
  params: unknown;
}

type JsonRpcMessage = JsonRpcResponse | JsonRpcNotification | JsonRpcServerRequest;

// =============================================================================
// App-Server Protocol Types (subset we care about)
// =============================================================================

interface ThreadInfo {
  id: string;
  cwd: string;
  name?: string | null;
}

interface TurnInfo {
  id: string;
  status: "completed" | "interrupted" | "failed" | "inProgress";
}

interface FileUpdateChange {
  path: string;
  kind: { type: "add" } | { type: "delete" } | { type: "update"; move_path?: string | null };
  diff: string;
}

interface TokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

interface ThreadItemBase {
  type: string;
  id: string;
}

interface CommandExecutionItem extends ThreadItemBase {
  type: "commandExecution";
  command: string;
  cwd: string;
  status: "inProgress" | "completed" | "failed" | "declined";
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  durationMs?: number | null;
}

interface FileChangeItem extends ThreadItemBase {
  type: "fileChange";
  changes: FileUpdateChange[];
  status: "inProgress" | "completed" | "failed" | "declined";
}

interface AgentMessageItem extends ThreadItemBase {
  type: "agentMessage";
  text: string;
}

interface ReasoningItem extends ThreadItemBase {
  type: "reasoning";
  summary: string[];
  content: string[];
}

interface McpToolCallItem extends ThreadItemBase {
  type: "mcpToolCall";
  server: string;
  tool: string;
  status: string;
  durationMs?: number | null;
}

interface DynamicToolCallItem extends ThreadItemBase {
  type: "dynamicToolCall";
  tool: string;
  status: string;
  durationMs?: number | null;
}

type ThreadItem =
  | CommandExecutionItem
  | FileChangeItem
  | AgentMessageItem
  | ReasoningItem
  | McpToolCallItem
  | DynamicToolCallItem
  | (ThreadItemBase & Record<string, unknown>);

// =============================================================================
// Session Options
// =============================================================================

export interface CodexAppServerSessionOptions {
  cwd: string;
  model?: string;
  planMode?: boolean;
  resumeSessionId?: string;
  dangerouslySkipPermissions?: boolean;
  logger: CoreConfig["logger"];
  processTimeout?: number;
  spawnProcess?: SpawnFn;
  codexPath?: string;
}

// =============================================================================
// Helpers
// =============================================================================

function trackFileChange(
  files: Map<string, FileChange>,
  path: string,
  type: "added" | "edited",
): void {
  const existing = files.get(path);
  if (existing) {
    existing.editCount++;
    if (existing.type !== "added") existing.type = type;
    return;
  }
  files.set(path, { path, editCount: 1, type });
}

// =============================================================================
// CodexAppServerSession
// =============================================================================

export class CodexAppServerSession extends EventEmitter implements ProviderSession {
  private process: ChildProcess | null = null;
  private readonly logger: CoreConfig["logger"];
  private readonly cwd: string;
  private readonly processTimeout: number;
  private readonly spawnProcess: SpawnFn;
  private readonly codexPath: string;

  private _isProcessing = false;
  private _sessionId: string | undefined;
  private _preferredModel: string | null;
  private _planMode: boolean;
  private _bypassPermissions: boolean;
  private _stats: SessionStats = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };

  private readonly fileMap = new Map<string, FileChange>();
  private readonly pendingRpcResponses = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (err: Error) => void }
  >();
  /** Pending approval requests from the server, keyed by stringified request id. */
  private readonly pendingApprovals = new Map<
    string,
    { method: string; params: Record<string, unknown>; rpcId: number | string }
  >();

  private nextRpcId = 1;
  private lineBuffer = "";
  private stderrBuffer = "";
  private initialized = false;
  private _currentTurnId: string | null = null;
  private _startedResolve: (() => void) | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  // Track whether we initiated close, to suppress spurious exit events
  private _closingIntentionally = false;

  constructor(options: CodexAppServerSessionOptions) {
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
    this._planMode = options.planMode ?? false;
    this._bypassPermissions = options.dangerouslySkipPermissions ?? false;
    if (this._preferredModel) {
      this._stats.model = this._preferredModel;
    }
  }

  // ===========================================================================
  // ProviderSession interface
  // ===========================================================================

  get isProcessing(): boolean {
    return this._isProcessing;
  }

  get provider(): "codex" {
    return "codex";
  }

  get pid(): number | undefined {
    return this.process?.pid;
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
      runtimeMode: this._planMode
        ? "plan"
        : this._bypassPermissions
          ? "full-access"
          : "approval-required",
    };
  }

  send(message: string): void {
    if (this._isProcessing) {
      this.logger.warn("[CodexAppServer] Already processing, ignoring message");
      return;
    }

    this._isProcessing = true;
    this.resetTimeout();

    if (!this.process || !this.initialized) {
      // First message — spawn the app-server process, initialize, start/resume thread, then send turn
      this.spawnAndInit(message);
    } else {
      // Subsequent messages — just start a new turn on the existing thread
      this.startTurn(message);
    }
  }

  interrupt(): void {
    if (!this._currentTurnId || !this._sessionId) return;
    this.logger.info("[CodexAppServer] Interrupting turn...");
    this.sendRpc("turn/interrupt", {
      threadId: this._sessionId,
      turnId: this._currentTurnId,
    }).catch((err) => {
      this.logger.warn(`[CodexAppServer] Interrupt failed: ${err}`);
    });
  }

  close(): void {
    this.clearTimeout();
    this._closingIntentionally = true;
    if (this.process) {
      this.process.kill("SIGTERM");
      // Give it a moment to exit gracefully, then force kill
      setTimeout(() => {
        if (this.process && this.process.exitCode === null && !this.process.killed) {
          this.process.kill("SIGKILL");
        }
      }, 2000);
    }
    this._isProcessing = false;
    this.initialized = false;
    // Reject any pending RPC calls
    for (const [, pending] of this.pendingRpcResponses) {
      pending.reject(new Error("Session closed"));
    }
    this.pendingRpcResponses.clear();
    this.pendingApprovals.clear();
  }

  addAllowedTool(_tool: string): void {
    // App-server uses requestApproval flow — individual tool allow-listing
    // is handled by responding to specific approval requests. We keep track
    // of approved tools via the pendingApprovals map + respondToRequest.
  }

  setModel(model: string | null): void {
    this._preferredModel = model;
    this._stats.model = model ?? undefined;
    this.emit("stats", { ...this._stats });
  }

  setReasoningBudget(_budget: number | null): void {
    // Codex doesn't expose a reasoning budget parameter directly.
  }

  setBypassPermissions(bypass: boolean): void {
    this._bypassPermissions = bypass;
    if (bypass) this._planMode = false;
  }

  setPlanMode(planMode: boolean): void {
    this._planMode = planMode;
    if (planMode) {
      this._bypassPermissions = false;
    }
  }

  respondToRequest(requestId: string, decision: "accept" | "decline"): boolean {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return false;

    this.pendingApprovals.delete(requestId);

    // Build the appropriate response based on the approval type
    let responseResult: unknown;
    if (pending.method === "item/commandExecution/requestApproval") {
      responseResult = { decision: decision === "accept" ? "accept" : "decline" };
    } else if (pending.method === "item/fileChange/requestApproval") {
      responseResult = { decision: decision === "accept" ? "accept" : "decline" };
    } else {
      responseResult = { decision: decision === "accept" ? "accept" : "decline" };
    }

    // Send the JSON-RPC response to the server's request
    this.sendRpcResponse(pending.rpcId, responseResult);
    return true;
  }

  // ===========================================================================
  // Process lifecycle
  // ===========================================================================

  private spawnAndInit(firstMessage: string): void {
    this.process = this.spawnProcess(this.codexPath, ["app-server", "--listen", "stdio://"], {
      cwd: this.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.wireStdout(this.process.stdout);
    this.wireStderr(this.process.stderr);
    this.wireLifecycle(this.process);

    // Initialize, then start/resume thread, then start first turn
    this.initializeAndStartThread(firstMessage).catch((err) => {
      this.logger.error(`[CodexAppServer] Init failed: ${err}`);
      this.finishTurn();
      this.emitExit(1, String(err));
    });
  }

  private async initializeAndStartThread(message: string): Promise<void> {
    // Step 1: Initialize
    await this.sendRpc("initialize", {
      clientInfo: { name: "relay", version: "0.0.0" },
      capabilities: { experimentalApi: true },
    });
    this.initialized = true;

    // Send "initialized" notification
    this.sendNotification("initialized");

    // Step 2: Start or resume thread
    if (this._sessionId) {
      const result = (await this.sendRpc("thread/resume", {
        threadId: this._sessionId,
        model: this._preferredModel ?? undefined,
        cwd: this.cwd,
        approvalPolicy: this.resolveApprovalPolicy(),
        sandbox: this.resolveSandboxMode(),
        persistExtendedHistory: true,
      })) as { thread?: ThreadInfo };
      if (result?.thread?.id) {
        this._sessionId = result.thread.id;
      }
    } else {
      const result = (await this.sendRpc("thread/start", {
        model: this._preferredModel ?? undefined,
        cwd: this.cwd,
        approvalPolicy: this.resolveApprovalPolicy(),
        sandbox: this.resolveSandboxMode(),
        experimentalRawEvents: false,
        persistExtendedHistory: true,
      })) as { thread?: ThreadInfo };
      if (result?.thread?.id) {
        this._sessionId = result.thread.id;
      }
    }

    // Step 3: Start first turn
    this.startTurn(message);
  }

  private startTurn(message: string): void {
    if (!this._sessionId) {
      this.logger.error("[CodexAppServer] No thread ID, can't start turn");
      this.finishTurn();
      return;
    }

    this.sendRpc("turn/start", {
      threadId: this._sessionId,
      input: [{ type: "text", text: message, text_elements: [] }],
      model: this._preferredModel ?? undefined,
      approvalPolicy: this.resolveApprovalPolicy(),
      collaborationMode: {
        mode: this._planMode ? "plan" : "default",
        settings: {
          model: this.resolveCollaborationModel(),
        },
      },
    }).catch((err) => {
      this.logger.error(`[CodexAppServer] turn/start failed: ${err}`);
      this.finishTurn();
    });
  }

  private resolveCollaborationModel(): string {
    return (
      this._preferredModel ??
      getBuiltinProviderModels("codex").find((model) => model.isDefault)?.id ??
      getBuiltinProviderModels("codex")[0]?.id ??
      "gpt-5.4"
    );
  }

  // ===========================================================================
  // JSON-RPC transport
  // ===========================================================================

  private sendRpc(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error("Process stdin not writable"));
        return;
      }

      const id = this.nextRpcId++;
      this.pendingRpcResponses.set(id, { resolve, reject });

      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      this.process.stdin.write(JSON.stringify(request) + "\n");
    });
  }

  private sendRpcResponse(id: number | string, result: unknown): void {
    if (!this.process?.stdin?.writable) return;
    const response = { jsonrpc: "2.0", id, result };
    this.process.stdin.write(JSON.stringify(response) + "\n");
  }

  private sendNotification(method: string, params?: unknown): void {
    if (!this.process?.stdin?.writable) return;
    const notification: { jsonrpc: "2.0"; method: string; params?: unknown } = {
      jsonrpc: "2.0",
      method,
    };
    if (params !== undefined) notification.params = params;
    this.process.stdin.write(JSON.stringify(notification) + "\n");
  }

  // ===========================================================================
  // Stream parsing
  // ===========================================================================

  private wireStdout(stream: Readable | null): void {
    if (!stream) return;
    stream.on("data", (chunk: Buffer | string) => {
      this.lineBuffer += chunk.toString();
      let idx = this.lineBuffer.indexOf("\n");
      while (idx !== -1) {
        const line = this.lineBuffer.slice(0, idx).trim();
        this.lineBuffer = this.lineBuffer.slice(idx + 1);
        if (line) this.handleLine(line);
        idx = this.lineBuffer.indexOf("\n");
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
      this.logger.debug(`[CodexAppServer] stderr: ${text.trim()}`);
    });
  }

  private wireLifecycle(child: ChildProcess): void {
    child.on("close", (code, signal) => {
      this.clearTimeout();
      const wasProcessing = this._isProcessing;
      this.process = null;
      this.initialized = false;

      if (wasProcessing) {
        this.finishTurn();
      }

      // Reject pending RPCs
      for (const [, pending] of this.pendingRpcResponses) {
        pending.reject(new Error(`Process exited (${code ?? signal})`));
      }
      this.pendingRpcResponses.clear();
      this.pendingApprovals.clear();

      if (!this._closingIntentionally) {
        this.emitExit(code ?? 1, signal ?? undefined);
      }
    });

    child.on("error", (err) => {
      this.clearTimeout();
      this.process = null;
      this._isProcessing = false;
      this.initialized = false;
      this.emitExit(1, String(err));
    });
  }

  private handleLine(line: string): void {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.logger.debug(`[CodexAppServer] Non-JSON line: ${line}`);
      return;
    }

    // Response to our request
    if ("id" in msg && msg.id !== undefined && !("method" in msg)) {
      this.handleRpcResponse(msg as JsonRpcResponse);
      return;
    }

    // Server request (has both id and method — needs a response from us)
    if ("id" in msg && msg.id !== undefined && "method" in msg) {
      this.handleServerRequest(msg as JsonRpcServerRequest);
      return;
    }

    // Notification (no id, has method)
    if ("method" in msg) {
      this.handleNotification(msg as JsonRpcNotification);
    }
  }

  private handleRpcResponse(msg: JsonRpcResponse): void {
    const id = typeof msg.id === "number" ? msg.id : Number(msg.id);
    const pending = this.pendingRpcResponses.get(id);
    if (!pending) return;
    this.pendingRpcResponses.delete(id);

    if (msg.error) {
      pending.reject(new Error(msg.error.message ?? `RPC error ${msg.error.code ?? "unknown"}`));
    } else {
      pending.resolve(msg.result);
    }
  }

  // ===========================================================================
  // Server requests (approval flow)
  // ===========================================================================

  private handleServerRequest(msg: JsonRpcServerRequest): void {
    const params = msg.params as Record<string, unknown>;

    switch (msg.method) {
      case "item/commandExecution/requestApproval": {
        const requestId = `codex-approval-${msg.id}`;
        this.pendingApprovals.set(requestId, {
          method: msg.method,
          params,
          rpcId: msg.id,
        });

        // If bypass mode, auto-approve
        if (this._bypassPermissions) {
          this.respondToRequest(requestId, "accept");
          return;
        }

        const command = (params.command as string) ?? "unknown command";
        const request: ProviderRequest = {
          requestId,
          kind: "approval",
          tool: "Bash",
          description: command,
        };
        this.emit("permissionRequest", request);

        // Also emit as activity so the UI knows an approval is needed
        this.emit("activity", {
          type: "activity",
          activity: "tool_use",
          tool: "Bash",
          description: `Requesting approval: ${command}`,
          detail: command,
          input: { command },
          inputDescription: command,
        } as ActivityMessage);
        break;
      }

      case "item/fileChange/requestApproval": {
        const requestId = `codex-approval-${msg.id}`;
        this.pendingApprovals.set(requestId, {
          method: msg.method,
          params,
          rpcId: msg.id,
        });

        if (this._bypassPermissions) {
          this.respondToRequest(requestId, "accept");
          return;
        }

        const reason = (params.reason as string) ?? "File change";
        const request: ProviderRequest = {
          requestId,
          kind: "approval",
          tool: "Edit",
          description: reason,
        };
        this.emit("permissionRequest", request);
        break;
      }

      // Legacy approval methods
      case "applyPatchApproval": {
        const requestId = `codex-approval-${msg.id}`;
        this.pendingApprovals.set(requestId, {
          method: msg.method,
          params,
          rpcId: msg.id,
        });

        if (this._bypassPermissions) {
          this.respondToRequest(requestId, "accept");
          return;
        }

        const request: ProviderRequest = {
          requestId,
          kind: "approval",
          tool: "Edit",
          description: "Apply patch",
        };
        this.emit("permissionRequest", request);
        break;
      }

      case "execCommandApproval": {
        const requestId = `codex-approval-${msg.id}`;
        this.pendingApprovals.set(requestId, {
          method: msg.method,
          params,
          rpcId: msg.id,
        });

        if (this._bypassPermissions) {
          this.respondToRequest(requestId, "accept");
          return;
        }

        const cmd = (params.command as string) ?? "unknown";
        const request: ProviderRequest = {
          requestId,
          kind: "approval",
          tool: "Bash",
          description: cmd,
        };
        this.emit("permissionRequest", request);
        break;
      }

      default:
        // Unknown server request — respond with error
        this.logger.warn(`[CodexAppServer] Unknown server request: ${msg.method}`);
        this.sendRpcResponse(msg.id, null);
        break;
    }
  }

  // ===========================================================================
  // Notifications
  // ===========================================================================

  private handleNotification(msg: JsonRpcNotification): void {
    const params = msg.params as Record<string, unknown>;

    switch (msg.method) {
      // -----------------------------------------------------------------------
      // Thread lifecycle
      // -----------------------------------------------------------------------
      case "thread/started": {
        const thread = params.thread as ThreadInfo | undefined;
        if (thread?.id) {
          this._sessionId = thread.id;
        }
        break;
      }

      case "thread/closed":
        // The server closed the thread — emit exit
        if (this._isProcessing) this.finishTurn();
        this.emitExit(0);
        break;

      case "thread/status/changed":
        this.logger.debug(`[CodexAppServer] Thread status: ${JSON.stringify(params.status)}`);
        break;

      case "thread/name/updated": {
        const name = typeof params.name === "string" ? params.name.trim() : "";
        if (name) {
          this.emit("titleUpdate", name);
        }
        break;
      }

      // -----------------------------------------------------------------------
      // Turn lifecycle
      // -----------------------------------------------------------------------
      case "turn/started": {
        const turn = params.turn as TurnInfo | undefined;
        if (turn?.id) {
          this._currentTurnId = turn.id;
        }
        break;
      }

      case "turn/completed": {
        this._currentTurnId = null;
        this.finishTurn();
        break;
      }

      case "turn/plan/updated": {
        const activity = buildTaskListActivityFromPlan({
          explanation: typeof params.explanation === "string" ? params.explanation : undefined,
          plan: Array.isArray(params.plan) ? params.plan : [],
        });
        if (activity) {
          this.emit("activity", activity);
        }
        break;
      }

      // -----------------------------------------------------------------------
      // Streaming text
      // -----------------------------------------------------------------------
      case "item/agentMessage/delta": {
        const delta = params.delta as string;
        if (delta) {
          this.emit("output", {
            type: "output",
            text: delta,
            isWaiting: false,
          } as OutputMessage);
        }
        break;
      }

      // -----------------------------------------------------------------------
      // Item lifecycle (tool use / results)
      // -----------------------------------------------------------------------
      case "item/started": {
        const item = params.item as ThreadItem;
        this.handleItemStarted(item);
        break;
      }

      case "item/completed": {
        const item = params.item as ThreadItem;
        this.handleItemCompleted(item);
        break;
      }

      // -----------------------------------------------------------------------
      // Streaming tool output
      // -----------------------------------------------------------------------
      case "item/commandExecution/outputDelta": {
        // We could emit incremental Bash output here if we wanted to show
        // live command output. For now we rely on item/completed for the
        // aggregated output.
        break;
      }

      case "item/fileChange/outputDelta": {
        // Similarly, patch output deltas — we track completed file changes
        break;
      }

      // -----------------------------------------------------------------------
      // Reasoning
      // -----------------------------------------------------------------------
      case "item/reasoning/textDelta":
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/summaryPartAdded":
        // Extended thinking — we could emit these as activity if desired
        break;

      // -----------------------------------------------------------------------
      // Token usage
      // -----------------------------------------------------------------------
      case "thread/tokenUsage/updated": {
        const usage = params.tokenUsage as
          | {
              total?: TokenUsageBreakdown;
              last?: TokenUsageBreakdown;
              modelContextWindow?: number | null;
            }
          | undefined;
        if (usage?.total) {
          this._stats.inputTokens = usage.total.inputTokens;
          this._stats.cacheReadTokens = usage.total.cachedInputTokens;
          this._stats.outputTokens = usage.total.outputTokens;
          this._stats.reasoningTokens = usage.total.reasoningOutputTokens;
          this._stats.contextTokens = usage.last?.inputTokens;
          if (typeof usage.modelContextWindow === "number") {
            this._stats.contextWindow = usage.modelContextWindow;
          }
          this.emit("stats", { ...this._stats });
        }
        break;
      }

      // -----------------------------------------------------------------------
      // Errors
      // -----------------------------------------------------------------------
      case "error": {
        const error = params.error as { message?: string } | undefined;
        const willRetry = params.willRetry as boolean | undefined;
        if (!willRetry) {
          this.logger.error(`[CodexAppServer] Error: ${error?.message ?? "unknown"}`);
        }
        break;
      }

      // -----------------------------------------------------------------------
      // Approval resolved (server tells us an approval was auto-resolved)
      // -----------------------------------------------------------------------
      case "serverRequest/resolved": {
        const resolvedId = params.requestId as string | number | undefined;
        if (resolvedId !== undefined) {
          const key = `codex-approval-${resolvedId}`;
          this.pendingApprovals.delete(key);
        }
        break;
      }

      default:
        this.logger.debug(`[CodexAppServer] Notification: ${msg.method}`);
        break;
    }
  }

  // ===========================================================================
  // Item handling
  // ===========================================================================

  private handleItemStarted(item: ThreadItem): void {
    if (!item) return;

    switch (item.type) {
      case "commandExecution": {
        const cmd = (item as CommandExecutionItem).command;
        this.emit("activity", {
          type: "activity",
          activity: "tool_use",
          tool: "Bash",
          description: `Running command: ${cmd}`,
          detail: cmd,
          input: { command: cmd },
          inputDescription: cmd,
          raw: item,
        } as ActivityMessage);
        break;
      }

      case "fileChange": {
        const changes = (item as FileChangeItem).changes;
        const paths = changes.map((c) => c.path).join(", ");
        this.emit("activity", {
          type: "activity",
          activity: "tool_use",
          tool: "Edit",
          description: "Editing files",
          detail: paths || undefined,
          raw: item,
        } as ActivityMessage);
        break;
      }

      case "mcpToolCall": {
        const mcp = item as McpToolCallItem;
        this.emit("activity", {
          type: "activity",
          activity: "tool_use",
          tool: mcp.tool,
          description: `Using ${mcp.server}/${mcp.tool}`,
          raw: item,
        } as ActivityMessage);
        break;
      }

      case "dynamicToolCall": {
        const dyn = item as DynamicToolCallItem;
        this.emit("activity", {
          type: "activity",
          activity: "tool_use",
          tool: dyn.tool,
          description: `Using ${dyn.tool}`,
          raw: item,
        } as ActivityMessage);
        break;
      }

      default:
        break;
    }
  }

  private handleItemCompleted(item: ThreadItem): void {
    if (!item) return;

    switch (item.type) {
      case "agentMessage": {
        // Full message on completion (delta already streamed it incrementally).
        // No need to re-emit — the deltas already provided the text.
        break;
      }

      case "commandExecution": {
        const cmd = item as CommandExecutionItem;
        const outputText = cmd.aggregatedOutput?.trim();
        const status =
          cmd.exitCode === 0 || cmd.status === "completed" ? "Command completed" : "Command failed";

        this.emit("activity", {
          type: "activity",
          activity: "tool_result",
          tool: "Bash",
          description: status,
          detail: outputText || cmd.command,
          input: { command: cmd.command, exitCode: cmd.exitCode ?? undefined },
          inputDescription: cmd.command,
          raw: item,
        } as ActivityMessage);
        break;
      }

      case "fileChange": {
        const fc = item as FileChangeItem;
        for (const change of fc.changes) {
          const changeType = change.kind.type === "add" ? "added" : "edited";
          trackFileChange(this.fileMap, change.path, changeType);
        }

        if (this.fileMap.size > 0) {
          this.emit("activity", {
            type: "activity",
            activity: "file_list",
            description: "Files changed",
            files: Array.from(this.fileMap.values()).map((f) => ({ ...f })),
          } as ActivityMessage);
        }

        const detail = fc.status === "completed" ? "Patch applied" : `Patch ${fc.status}`;
        this.emit("activity", {
          type: "activity",
          activity: "tool_result",
          tool: "Edit",
          description: "Tool completed",
          detail,
          raw: item,
        } as ActivityMessage);
        break;
      }

      case "mcpToolCall": {
        const mcp = item as McpToolCallItem;
        this.emit("activity", {
          type: "activity",
          activity: "tool_result",
          tool: mcp.tool,
          description: `${mcp.server}/${mcp.tool} completed`,
          raw: item,
        } as ActivityMessage);
        break;
      }

      case "dynamicToolCall": {
        const dyn = item as DynamicToolCallItem;
        this.emit("activity", {
          type: "activity",
          activity: "tool_result",
          tool: dyn.tool,
          description: `${dyn.tool} completed`,
          raw: item,
        } as ActivityMessage);
        break;
      }

      default:
        break;
    }
  }

  // ===========================================================================
  // Turn lifecycle
  // ===========================================================================

  private finishTurn(): void {
    if (!this._isProcessing) return;
    this.clearTimeout();
    this._isProcessing = false;
    this._currentTurnId = null;
    this.emit("output", {
      type: "output",
      text: "",
      isWaiting: true,
    } as OutputMessage);
  }

  private emitExit(code: number, stderrOrSignal?: string): void {
    const exit: ExitMessage = {
      type: "exit",
      code,
      signal: stderrOrSignal ?? undefined,
      stderr: this.stderrBuffer.trim() || undefined,
    };
    this.emit("exit", exit);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private resolveApprovalPolicy(): string {
    if (this._bypassPermissions) return "never";
    // "on-failure" is the default — approve commands, ask on failure
    // "untrusted" means ask for everything
    return "on-failure";
  }

  private resolveSandboxMode(): string {
    if (this._bypassPermissions) return "danger-full-access";
    return "workspace-write";
  }

  private resetTimeout(): void {
    this.clearTimeout();
    if (this.processTimeout <= 0) return;
    this.timeoutHandle = setTimeout(() => {
      if (!this.process) return;
      this.logger.warn(`[CodexAppServer] Timeout after ${this.processTimeout}ms`);
      this.close();
    }, this.processTimeout);
  }

  private clearTimeout(): void {
    if (!this.timeoutHandle) return;
    clearTimeout(this.timeoutHandle);
    this.timeoutHandle = null;
  }
}
