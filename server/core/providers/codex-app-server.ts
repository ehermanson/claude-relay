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
  ProviderAccountStatus,
  ProviderDiffStatus,
  ProviderMcpServerStatus,
  ProviderNotice,
  ProviderRateLimitStatus,
  SessionStats,
  SystemEventMessage,
  ProviderModelOptions,
  ProviderRequest,
  ProviderRequestResponse,
  ProviderRuntimeBinding,
  UserInputQuestion,
} from "#core/types.js";
import type { CoreConfig } from "#core/config.js";
import type { ProviderSession } from "#core/provider.js";
import { buildSessionInitEvent } from "#core/session-init.js";
import { buildTaskListActivityFromPlan } from "#core/tools.js";
import { ProposedPlanStreamParser } from "#core/proposed-plan.js";
import { isPathWithinWorkspace } from "#core/workspace-paths.js";
import { findCodexBinary } from "#core/providers/codex-cli.js";
import { getBuiltinProviderModels } from "#core/provider-catalog.js";

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
  arguments?: unknown;
  success?: boolean | null;
  contentItems?: Array<{ text?: string; [key: string]: unknown }> | null;
}

interface ContextCompactionItem {
  type: "compaction";
  encrypted_content: string;
}

interface RequestUserInputParams {
  itemId: string;
  questions: UserInputQuestion[];
  threadId: string;
  turnId: string;
}

interface TerminalInteractionParams {
  itemId?: string;
  command?: string;
  cwd?: string;
  prompt?: string;
  text?: string;
  isSecret?: boolean;
  [key: string]: unknown;
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
  modelOptions?: ProviderModelOptions;
}

export interface CodexProviderGlobalStateSnapshotOptions {
  cwd: string;
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
  root: string,
  path: string,
  type: "added" | "edited",
): void {
  if (!isPathWithinWorkspace(root, path)) return;
  const existing = files.get(path);
  if (existing) {
    existing.editCount++;
    if (existing.type !== "added") existing.type = type;
    return;
  }
  files.set(path, { path, editCount: 1, type });
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return strings.length > 0 ? strings : undefined;
}

function buildRequestDescription(params: Record<string, unknown>): string | undefined {
  return (
    getString(params.reason) ??
    getString(params.prompt) ??
    getString(params.command) ??
    getString(params.description)
  );
}

function buildProviderNotice(
  level: ProviderNotice["level"],
  scope: ProviderNotice["scope"],
  source: string,
  params: Record<string, unknown>,
): ProviderNotice | null {
  const message =
    getString(params.message) ??
    getString((params.warning as Record<string, unknown> | undefined)?.message) ??
    getString((params.notice as Record<string, unknown> | undefined)?.message);
  if (!message) return null;
  return {
    level,
    scope,
    source,
    code:
      getString(params.code) ??
      getString((params.warning as Record<string, unknown> | undefined)?.code) ??
      getString((params.notice as Record<string, unknown> | undefined)?.code),
    message,
    detail:
      getString(params.detail) ??
      getString((params.warning as Record<string, unknown> | undefined)?.detail) ??
      getString((params.notice as Record<string, unknown> | undefined)?.detail),
  };
}

function buildMcpServerStatusList(value: unknown): ProviderMcpServerStatus[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const servers: ProviderMcpServerStatus[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const name = getString(row.name) ?? getString(row.server);
    if (!name) continue;
    const tools = Array.isArray(row.tools) ? row.tools.length : undefined;
    servers.push({
      name,
      status: getString(row.status),
      authStatus: getString(row.authStatus) ?? getString(row.auth_status),
      connected: typeof row.connected === "boolean" ? row.connected : undefined,
      toolCount: tools,
      detail: getString(row.detail) ?? getString(row.message),
    });
  }
  return servers.length > 0 ? servers : undefined;
}

function buildAccountStatus(params: Record<string, unknown>): ProviderAccountStatus | undefined {
  const account = (params.account as Record<string, unknown> | undefined) ?? params;
  const rateLimits: NonNullable<ProviderAccountStatus["rateLimits"]> = [];
  if (Array.isArray(account.rateLimits)) {
    for (const entry of account.rateLimits) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      rateLimits.push({
        name: getString(row.name),
        scope: getString(row.scope),
        plan: getString(row.plan) ?? getString(row.planType),
        windows: [
          {
            label: getString(row.label),
            limit: typeof row.limit === "number" ? row.limit : undefined,
            remaining: typeof row.remaining === "number" ? row.remaining : undefined,
            usedPercent: typeof row.usedPercent === "number" ? row.usedPercent : undefined,
            windowMinutes:
              typeof row.windowMinutes === "number"
                ? row.windowMinutes
                : typeof row.windowDurationMins === "number"
                  ? row.windowDurationMins
                  : undefined,
            resetAt: getString(row.resetAt) ?? getString(row.reset_at),
          },
        ],
      });
    }
  }
  const result: ProviderAccountStatus = {
    plan: getString(account.plan) ?? getString(account.planType),
    label: getString(account.label) ?? getString(account.name),
    email: getString(account.email),
    status: getString(account.status),
    rateLimits: rateLimits.length ? rateLimits : undefined,
  };
  return result.plan || result.label || result.email || result.status || result.rateLimits
    ? result
    : undefined;
}

function buildDiffStatus(params: Record<string, unknown>): ProviderDiffStatus | undefined {
  const changedFiles =
    typeof params.changedFiles === "number"
      ? params.changedFiles
      : typeof params.changed_files === "number"
        ? params.changed_files
        : undefined;
  const result: ProviderDiffStatus = {
    status: getString(params.status),
    changedFiles,
    summary:
      getString(params.summary) ??
      (typeof changedFiles === "number"
        ? `${changedFiles} file${changedFiles === 1 ? "" : "s"} changed`
        : undefined),
  };
  return result.status || result.summary || typeof result.changedFiles === "number"
    ? result
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function normalizeCodexAccountSnapshot(result: unknown): ProviderAccountStatus | undefined {
  const payload = asRecord(result);
  const account = asRecord(payload?.account);
  const accountType = getString(account?.type);
  const planType = getString(account?.planType);
  const email = getString(account?.email);
  const requiresOpenaiAuth =
    typeof payload?.requiresOpenaiAuth === "boolean" ? payload.requiresOpenaiAuth : false;

  const status =
    getString(payload?.status) ??
    (requiresOpenaiAuth ? "auth_required" : accountType === "apiKey" ? "api_key" : undefined);

  const label =
    getString(payload?.label) ??
    (accountType === "chatgpt"
      ? "ChatGPT account"
      : accountType === "apiKey"
        ? "API key"
        : undefined);

  const normalized: ProviderAccountStatus = {
    plan: planType,
    label,
    email,
    status,
  };

  return normalized.plan || normalized.label || normalized.email || normalized.status
    ? normalized
    : undefined;
}

function normalizeCodexRateLimitsSnapshot(
  result: unknown,
): ProviderAccountStatus["rateLimits"] | undefined {
  const payload = asRecord(result);
  const primary = payload?.rateLimits;
  const byLimitId = asRecord(payload?.rateLimitsByLimitId);
  const snapshots: unknown[] = [];
  if (primary) snapshots.push(primary);
  if (byLimitId) {
    for (const value of Object.values(byLimitId)) {
      if (value) snapshots.push(value);
    }
  }

  const seen = new Set<string>();
  const limits: NonNullable<ProviderAccountStatus["rateLimits"]> = [];
  for (const snapshotValue of snapshots) {
    const snapshot = asRecord(snapshotValue);
    if (!snapshot) continue;
    const primaryWindow = asRecord(snapshot.primary);
    const secondaryWindow = asRecord(snapshot.secondary);
    const name = getString(snapshot.limitName) ?? getString(snapshot.limitId);
    const scope = getString(snapshot.limitId);
    const dedupeKey = `${scope ?? ""}|${name ?? ""}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const windows: NonNullable<ProviderRateLimitStatus["windows"]> = [];
    if (primaryWindow) {
      const usedPercent =
        typeof primaryWindow.usedPercent === "number" ? primaryWindow.usedPercent : undefined;
      windows.push({
        label: "Primary",
        usedPercent,
        remaining:
          typeof usedPercent === "number" ? Math.max(0, Math.round(100 - usedPercent)) : undefined,
        windowMinutes:
          typeof primaryWindow.windowDurationMins === "number"
            ? primaryWindow.windowDurationMins
            : undefined,
        resetAt:
          typeof primaryWindow.resetsAt === "number"
            ? new Date(primaryWindow.resetsAt * 1000).toISOString()
            : undefined,
      });
    }
    if (secondaryWindow) {
      const usedPercent =
        typeof secondaryWindow.usedPercent === "number" ? secondaryWindow.usedPercent : undefined;
      windows.push({
        label: "Secondary",
        usedPercent,
        remaining:
          typeof usedPercent === "number" ? Math.max(0, Math.round(100 - usedPercent)) : undefined,
        windowMinutes:
          typeof secondaryWindow.windowDurationMins === "number"
            ? secondaryWindow.windowDurationMins
            : undefined,
        resetAt:
          typeof secondaryWindow.resetsAt === "number"
            ? new Date(secondaryWindow.resetsAt * 1000).toISOString()
            : undefined,
      });
    }
    limits.push({
      name,
      scope,
      plan: getString(snapshot.planType),
      windows: windows.length ? windows : undefined,
    });
  }

  return limits.length ? limits : undefined;
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
  private _pendingMessage: string | null = null;
  private _planDeltaBuffer = "";
  private _lastEmittedPlan = "";
  private _sessionId: string | undefined;
  private _preferredModel: string | null;
  private _planMode: boolean;
  private _bypassPermissions: boolean;
  private _modelOptions: ProviderModelOptions;
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
  /** Pending user-action requests from the server, keyed by stringified request id. */
  private readonly pendingRequests = new Map<
    string,
    {
      kind: "approval" | "user_input" | "terminal_input";
      method: string;
      params: Record<string, unknown> | RequestUserInputParams | TerminalInteractionParams;
      rpcId?: number | string;
    }
  >();

  private nextRpcId = 1;
  private lineBuffer = "";
  private stderrBuffer = "";
  private initialized = false;
  private _currentTurnId: string | null = null;
  private _lastCompactionTurnId: string | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly proposedPlanParser = new ProposedPlanStreamParser();

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
    this._modelOptions = options.modelOptions ?? {};
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
      this._pendingMessage = message;
      return;
    }

    this._isProcessing = true;
    this._planDeltaBuffer = "";
    this.resetTimeout();

    if (!this.process || !this.initialized) {
      this.spawnAndInit(message);
    } else {
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

  compactThread(): void {
    if (!this._sessionId) {
      this.emit("providerError", "Cannot compact before the Codex thread has started.");
      return;
    }
    if (this._isProcessing) {
      this.emit("providerError", "Cannot compact while another Codex turn is still running.");
      return;
    }

    this._isProcessing = true;
    this._planDeltaBuffer = "";
    this.resetTimeout();
    if (!this.hasWritableTransport() || !this.initialized) {
      this.spawnAndCompact();
      return;
    }

    this.startCompaction();
  }

  close(): Promise<void> {
    this.clearTimeout();
    this._closingIntentionally = true;
    const child = this.process;
    this._isProcessing = false;
    this._pendingMessage = null;
    this._planDeltaBuffer = "";
    this.initialized = false;
    // Reject any pending RPC calls
    for (const [, pending] of this.pendingRpcResponses) {
      pending.reject(new Error("Session closed"));
    }
    this.pendingRpcResponses.clear();
    this.pendingRequests.clear();
    if (!child) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.removeListener("exit", onExit);
        child.removeListener("error", onExit);
        if (this.process === child) {
          this.process = null;
        }
        resolve();
      };
      const onExit = () => finish();
      const timer = setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          child.kill("SIGKILL");
        }
        finish();
      }, 2000);
      timer.unref?.();
      child.once("exit", onExit);
      child.once("error", onExit);
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
      } else {
        finish();
      }
    });
  }

  addAllowedTool(_tool: string): void {
    // App-server uses requestApproval flow — individual tool allow-listing
    // is handled by responding to specific approval requests. We keep track
    // of approved tools via the pendingRequests map + respondToRequest.
  }

  setModel(model: string | null): void {
    this._preferredModel = model;
    this._stats.model = model ?? undefined;
    this.emit("stats", { ...this._stats });
  }

  setReasoningBudget(_budget: number | null): void {
    // Codex doesn't expose a reasoning budget parameter directly.
  }

  setModelOptions(modelOptions: ProviderModelOptions): void {
    this._modelOptions = { ...this._modelOptions, ...modelOptions };
  }

  setBypassPermissions(bypass: boolean): void {
    this._bypassPermissions = bypass;
    if (!bypass || this._planMode) return;

    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.kind !== "approval") continue;
      this.pendingRequests.delete(requestId);
      if (pending.rpcId !== undefined) {
        this.sendRpcResponse(pending.rpcId, { decision: "accept" });
      }
    }
  }

  setPlanMode(planMode: boolean): void {
    this._planMode = planMode;
  }

  respondToRequest(
    requestId: string,
    decision: "accept" | "decline",
    response?: ProviderRequestResponse,
  ): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending) return false;

    this.pendingRequests.delete(requestId);

    if (pending.kind === "user_input") {
      const answers = decision === "accept" ? (response?.answers ?? {}) : {};
      const hasAnswers = Object.keys(answers).length > 0;
      if (pending.rpcId !== undefined) {
        this.sendRpcResponse(pending.rpcId, { answers });
      }
      this.emit("activity", {
        type: "activity",
        activity: "tool_result",
        tool: "AskUserQuestion",
        description: "Tool completed",
        resolution: hasAnswers ? "approved" : "dismissed",
        input: {
          requestId,
        },
      } as ActivityMessage);
      return true;
    }

    if (pending.kind === "terminal_input") {
      const text = decision === "accept" ? (response?.text?.trim() ?? "") : "";
      if (pending.rpcId !== undefined) {
        this.sendRpcResponse(pending.rpcId, { text });
      } else if (decision === "accept" && text) {
        const itemId = getString((pending.params as TerminalInteractionParams).itemId);
        this.emit("activity", {
          type: "activity",
          activity: "tool_result",
          tool: "Bash",
          description: "Terminal input sent",
          detail: text,
          input: {
            requestId,
            itemId,
            text,
          },
        } as ActivityMessage);
      }
      return true;
    }

    const responseResult = { decision: decision === "accept" ? "accept" : "decline" };
    if (pending.rpcId !== undefined) {
      this.sendRpcResponse(pending.rpcId, responseResult);
    }
    return true;
  }

  // ===========================================================================
  // Process lifecycle
  // ===========================================================================

  private spawnAndInit(firstMessage: string): void {
    this._closingIntentionally = false;
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

  private spawnAndCompact(): void {
    this._closingIntentionally = false;
    this.process = this.spawnProcess(this.codexPath, ["app-server", "--listen", "stdio://"], {
      cwd: this.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.wireStdout(this.process.stdout);
    this.wireStderr(this.process.stderr);
    this.wireLifecycle(this.process);

    this.initializeAndCompactThread().catch((err) => {
      this.logger.error(`[CodexAppServer] Compact init failed: ${err}`);
      this.clearTimeout();
      this._isProcessing = false;
      this.emit("providerError", `Failed to compact context: ${err}`);
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
      this.logger.info(`[CodexAppServer] Resuming thread ${this._sessionId}`);
      const result = (await this.sendRpc("thread/resume", {
        threadId: this._sessionId,
        model: this._preferredModel ?? undefined,
        cwd: this.cwd,
        approvalPolicy: this.resolveApprovalPolicy(),
        sandbox: this.resolveSandboxMode(),
        persistExtendedHistory: true,
        ...this.resolveCodexModelParams(),
      })) as { thread?: ThreadInfo };
      if (result?.thread?.id) {
        this._sessionId = result.thread.id;
      }
      this.emitSessionInitEvent(result);
    } else {
      const result = (await this.sendRpc("thread/start", {
        model: this._preferredModel ?? undefined,
        cwd: this.cwd,
        approvalPolicy: this.resolveApprovalPolicy(),
        sandbox: this.resolveSandboxMode(),
        experimentalRawEvents: false,
        persistExtendedHistory: true,
        ...this.resolveCodexModelParams(),
      })) as { thread?: ThreadInfo };
      if (result?.thread?.id) {
        this._sessionId = result.thread.id;
      }
      this.emitSessionInitEvent(result);
    }

    this.requestStartupSnapshots();

    // Step 3: Start first turn
    this.startTurn(message);
  }

  private async initializeAndCompactThread(): Promise<void> {
    await this.sendRpc("initialize", {
      clientInfo: { name: "relay", version: "0.0.0" },
      capabilities: { experimentalApi: true },
    });
    this.initialized = true;

    this.sendNotification("initialized");

    if (this._sessionId) {
      this.logger.info(`[CodexAppServer] Resuming thread ${this._sessionId} for compaction`);
      const result = (await this.sendRpc("thread/resume", {
        threadId: this._sessionId,
        model: this._preferredModel ?? undefined,
        cwd: this.cwd,
        approvalPolicy: this.resolveApprovalPolicy(),
        sandbox: this.resolveSandboxMode(),
        persistExtendedHistory: true,
        ...this.resolveCodexModelParams(),
      })) as { thread?: ThreadInfo };
      if (result?.thread?.id) {
        this._sessionId = result.thread.id;
      }
    }

    this.requestStartupSnapshots();

    this.startCompaction();
  }

  private requestStartupSnapshots(): void {
    void this.sendRpc("mcpServerStatus/list", {})
      .then((result) => {
        const payload = asRecord(result);
        const mcpServers = buildMcpServerStatusList(payload?.servers ?? payload?.items ?? result);
        if (!mcpServers?.length) return;
        this.emit("systemEvent", {
          type: "system_event",
          event: "provider_status",
          payload: { mcpServers },
        } as SystemEventMessage);
      })
      .catch((err) => {
        this.logger.debug(`[CodexAppServer] mcpServerStatus/list snapshot unavailable: ${err}`);
      });

    void this.sendRpc("app/list", {})
      .then((result) => {
        const payload = asRecord(result);
        const apps = getStringArray(payload?.apps ?? payload?.items ?? result);
        if (!apps?.length) return;
        this.emit("systemEvent", {
          type: "system_event",
          event: "provider_status",
          payload: { apps },
        } as SystemEventMessage);
      })
      .catch((err) => {
        this.logger.debug(`[CodexAppServer] app/list snapshot unavailable: ${err}`);
      });

    void this.sendRpc("account/read", { refreshToken: false })
      .then((result) => {
        const account = normalizeCodexAccountSnapshot(result);
        if (account) {
          this.emit("systemEvent", {
            type: "system_event",
            event: "provider_status",
            payload: { account },
          } as SystemEventMessage);
        }
      })
      .catch((err) => {
        this.logger.debug(`[CodexAppServer] account/read snapshot unavailable: ${err}`);
      });

    void this.sendRpc("account/rateLimits/read", undefined)
      .then((result) => {
        const rateLimits = normalizeCodexRateLimitsSnapshot(result);
        if (!rateLimits?.length) return;
        this.emit("systemEvent", {
          type: "system_event",
          event: "provider_status",
          payload: {
            account: {
              rateLimits,
            },
          },
        } as SystemEventMessage);
      })
      .catch((err) => {
        this.logger.debug(`[CodexAppServer] account/rateLimits/read snapshot unavailable: ${err}`);
      });
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
      ...this.resolveCodexModelParams(),
    }).catch((err) => {
      this.logger.error(`[CodexAppServer] turn/start failed: ${err}`);
      this.finishTurn();
    });
  }

  private startCompaction(): void {
    if (!this._sessionId) {
      this.clearTimeout();
      this._isProcessing = false;
      this.emit("providerError", "Cannot compact before the Codex thread has started.");
      return;
    }

    this.sendRpc("thread/compact/start", {
      threadId: this._sessionId,
    }).catch((err) => {
      this.clearTimeout();
      this._isProcessing = false;
      this.logger.warn(`[CodexAppServer] thread/compact/start failed: ${err}`);
      this.emit("providerError", `Failed to compact context: ${err}`);
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

  /** Map canonical ReasoningEffort to Codex-native effort string. */
  private resolveCodexEffort(): string | undefined {
    const effort = this._modelOptions.reasoningEffort;
    if (!effort) return undefined;
    // Canonical Relay values → Codex-native
    const mapping: Record<string, string> = {
      low: "low",
      medium: "medium",
      high: "high",
      max: "xhigh",
    };
    // Known canonical mapping first, then pass through as-is (handles restored
    // Codex-native values like "xhigh" that survived round-trip via persistence).
    return mapping[effort] ?? effort;
  }

  /** Build Codex-specific model option params for thread/start and turn/start RPC. */
  private resolveCodexModelParams(): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    const effort = this.resolveCodexEffort();
    if (effort) params.reasoning_effort = effort;
    if (this._modelOptions.fastMode != null)
      params.service_tier = this._modelOptions.fastMode ? "flex" : "default";
    return params;
  }

  // ===========================================================================
  // JSON-RPC transport
  // ===========================================================================

  private sendRpc(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const stdin = this.process?.stdin;
      if (!stdin?.writable) {
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

      stdin.write(JSON.stringify(request) + "\n");
    });
  }

  private sendRpcResponse(id: number | string, result: unknown): void {
    const stdin = this.process?.stdin;
    if (!stdin?.writable) return;
    const response = { jsonrpc: "2.0", id, result };
    stdin.write(JSON.stringify(response) + "\n");
  }

  private sendNotification(method: string, params?: unknown): void {
    const stdin = this.process?.stdin;
    if (!stdin?.writable) return;
    const notification: { jsonrpc: "2.0"; method: string; params?: unknown } = {
      jsonrpc: "2.0",
      method,
    };
    if (params !== undefined) notification.params = params;
    stdin.write(JSON.stringify(notification) + "\n");
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
      this.pendingRequests.clear();

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
        this.pendingRequests.set(requestId, {
          kind: "approval",
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
          category: "command",
          source: "command",
          tool: "Bash",
          description: command,
          command,
          cwd: getString(params.cwd),
          raw: params,
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
        this.pendingRequests.set(requestId, {
          kind: "approval",
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
          category: "file_change",
          source: "agent",
          tool: "Edit",
          description: reason,
          reason,
          files: getStringArray(params.files),
          raw: params,
        };
        this.emit("permissionRequest", request);
        break;
      }

      case "item/permissions/requestApproval": {
        const requestId = `codex-approval-${msg.id}`;
        this.pendingRequests.set(requestId, {
          kind: "approval",
          method: msg.method,
          params,
          rpcId: msg.id,
        });

        if (this._bypassPermissions) {
          this.respondToRequest(requestId, "accept");
          return;
        }

        this.emit("permissionRequest", {
          requestId,
          kind: "approval",
          category: "generic",
          source: "provider",
          tool: getString(params.tool) ?? getString(params.permission) ?? "Permissions",
          description: buildRequestDescription(params) ?? "Permission request",
          command: getString(params.command),
          cwd: getString(params.cwd),
          reason: getString(params.reason),
          files: getStringArray(params.files),
          raw: params,
        } satisfies ProviderRequest);
        break;
      }

      // Legacy approval methods
      case "applyPatchApproval": {
        const requestId = `codex-approval-${msg.id}`;
        this.pendingRequests.set(requestId, {
          kind: "approval",
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
          category: "file_change",
          source: "provider",
          tool: "Edit",
          description: "Apply patch",
          raw: params,
        };
        this.emit("permissionRequest", request);
        break;
      }

      case "execCommandApproval": {
        const requestId = `codex-approval-${msg.id}`;
        this.pendingRequests.set(requestId, {
          kind: "approval",
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
          category: "command",
          source: "command",
          tool: "Bash",
          description: cmd,
          command: cmd,
          cwd: getString(params.cwd),
          raw: params,
        };
        this.emit("permissionRequest", request);
        break;
      }

      case "item/tool/requestUserInput": {
        const requestParams = msg.params as unknown as RequestUserInputParams;
        const questions = Array.isArray(requestParams.questions) ? requestParams.questions : [];
        const requestId = `codex-input-${requestParams.itemId || msg.id}`;

        this.pendingRequests.set(requestId, {
          kind: "user_input",
          method: msg.method,
          params: requestParams,
          rpcId: msg.id,
        });

        this.emit("permissionRequest", {
          requestId,
          kind: "user_input",
          source: "agent",
          tool: "AskUserQuestion",
          description: questions[0]?.question,
          questions,
          raw: requestParams as unknown as Record<string, unknown>,
        } as ProviderRequest);
        this.emit("activity", {
          type: "activity",
          activity: "tool_use",
          tool: "AskUserQuestion",
          description: "Question",
          input: {
            requestId,
            questions,
          },
          inputDescription: questions[0]?.question,
        } as ActivityMessage);
        break;
      }

      case "mcpServer/elicitation/request": {
        const requestId = `codex-input-${msg.id}`;
        const prompt = getString(params.prompt) ?? buildRequestDescription(params);
        const providedQuestions = Array.isArray(params.questions)
          ? (params.questions as UserInputQuestion[])
          : undefined;
        const questions =
          providedQuestions && providedQuestions.length > 0
            ? providedQuestions
            : prompt
              ? ([
                  {
                    id: "response",
                    header: "Input",
                    question: prompt,
                    isOther: true,
                    isSecret: Boolean(params.secret ?? params.isSecret),
                  },
                ] satisfies UserInputQuestion[])
              : undefined;

        this.pendingRequests.set(requestId, {
          kind: "user_input",
          method: msg.method,
          params,
          rpcId: msg.id,
        });

        this.emit("permissionRequest", {
          requestId,
          kind: "user_input",
          category: "generic",
          source: "mcp",
          tool: "MCP",
          server: getString(params.server),
          description: prompt ?? "MCP server needs input",
          prompt,
          questions,
          raw: params,
        } satisfies ProviderRequest);
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
        if (this._isProcessing) this.finishTurn();
        this.emitExit(0);
        break;

      case "thread/status/changed":
        this.emit("systemEvent", {
          type: "system_event",
          event: "provider_status",
          payload: {
            threadStatus: getString(params.status),
            threadId: this._sessionId,
          },
          raw: msg,
        } as SystemEventMessage);
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
        this.emit("systemEvent", {
          type: "system_event",
          event: "provider_status",
          payload: {
            turnStatus: turn?.status ?? "inProgress",
            turnId: turn?.id,
          },
          raw: msg,
        } as SystemEventMessage);
        break;
      }

      case "turn/completed": {
        const turn = params.turn as TurnInfo | undefined;
        this._currentTurnId = null;
        this.emit("systemEvent", {
          type: "system_event",
          event: "provider_status",
          payload: {
            turnStatus: turn?.status ?? "completed",
            turnId: turn?.id,
          },
          raw: msg,
        } as SystemEventMessage);
        this.finishTurn(params);
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
          for (const message of this.proposedPlanParser.push(delta, params)) {
            if (message.type === "output") {
              this.emit("output", message as OutputMessage);
            } else {
              this.emit("activity", message as ActivityMessage);
            }
          }
        }
        break;
      }

      case "item/plan/delta": {
        // Codex plan-mode streams plan content here instead of agentMessage/delta.
        // Accumulate silently — finishTurn wraps the buffer in <proposed_plan> tags
        // which triggers the plan-review UI via ExitPlanMode activity.
        const delta = (params.delta ?? params.text ?? "") as string;
        if (delta) {
          this._planDeltaBuffer += delta;
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

      case "item/commandExecution/terminalInteraction": {
        const terminal = params as TerminalInteractionParams;
        const itemId = getString(terminal.itemId) ?? `${this._currentTurnId ?? "turn"}-terminal`;
        const prompt = getString(terminal.prompt) ?? getString(terminal.text);
        if (!prompt) break;
        const requestId = `codex-terminal-${itemId}`;
        this.pendingRequests.set(requestId, {
          kind: "terminal_input",
          method: msg.method,
          params: terminal,
        });
        this.emit("permissionRequest", {
          requestId,
          kind: "terminal_input",
          category: "command",
          source: "command",
          tool: "Bash",
          description: prompt,
          prompt,
          command: getString(terminal.command),
          cwd: getString(terminal.cwd),
          raw: terminal,
        } satisfies ProviderRequest);
        this.emit("activity", {
          type: "activity",
          activity: "tool_use",
          tool: "Bash",
          description: "Terminal interaction required",
          detail: prompt,
          input: {
            requestId,
            prompt,
            command: getString(terminal.command),
            cwd: getString(terminal.cwd),
          },
          raw: terminal,
        } as ActivityMessage);
        break;
      }

      case "item/fileChange/outputDelta": {
        // Similarly, patch output deltas — we track completed file changes
        break;
      }

      case "item/mcpToolCall/progress": {
        const server = getString(params.server) ?? getString(params.mcpServer) ?? "MCP";
        const tool = getString(params.tool) ?? "tool";
        const progress =
          getString(params.message) ?? getString(params.status) ?? getString(params.detail);
        this.emit("activity", {
          type: "activity",
          activity: "tool_use",
          tool,
          description: `${server}/${tool}${progress ? `: ${progress}` : ""}`,
          detail: progress,
          raw: msg,
        } as ActivityMessage);
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

      case "rawResponseItem/completed": {
        const turnId =
          (typeof params.turnId === "string" ? params.turnId : undefined) ?? this._currentTurnId;
        const item = params.item as ContextCompactionItem | undefined;
        if (turnId && item?.type === "compaction") {
          this.emitCompactionEvent(turnId, params);
        }
        break;
      }

      case "thread/compacted": {
        const turnId =
          (typeof params.turnId === "string" ? params.turnId : undefined) ?? this._currentTurnId;
        if (turnId) {
          this.emitCompactionEvent(turnId, params);
        }
        break;
      }

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
          this._stats.contextTokens =
            usage.last?.totalTokens ??
            (typeof usage.last?.inputTokens === "number"
              ? usage.last.inputTokens + (usage.last.cachedInputTokens ?? 0)
              : undefined);
          if (typeof usage.modelContextWindow === "number") {
            this._stats.contextWindow = usage.modelContextWindow;
          }
          this.emit("stats", { ...this._stats });
        }
        break;
      }

      case "turn/diff/updated": {
        this.emit("systemEvent", {
          type: "system_event",
          event: "provider_status",
          payload: {
            diff: buildDiffStatus(params),
          },
          raw: msg,
        } as SystemEventMessage);
        break;
      }

      case "item/autoApprovalReview/started":
      case "item/autoApprovalReview/completed": {
        this.emit("systemEvent", {
          type: "system_event",
          event: "provider_status",
          payload: {
            source: msg.method,
            ...params,
          },
          raw: msg,
        } as SystemEventMessage);
        break;
      }

      case "mcpServerStatus/list": {
        this.emit("systemEvent", {
          type: "system_event",
          event: "provider_status",
          payload: {
            mcpServers: buildMcpServerStatusList(params.servers ?? params.items),
          },
          raw: msg,
        } as SystemEventMessage);
        break;
      }

      case "mcpServer/oauthLogin/completed": {
        const notice = buildProviderNotice("info", "global", msg.method, params) ?? {
          level: "info",
          scope: "global",
          source: msg.method,
          message: `MCP login completed for ${getString(params.server) ?? "server"}`,
        };
        this.emit("systemEvent", {
          type: "system_event",
          event: "provider_notice",
          payload: notice as unknown as Record<string, unknown>,
          raw: msg,
        } as SystemEventMessage);
        break;
      }

      case "account/updated":
      case "account/rateLimits/updated": {
        const account = buildAccountStatus(params);
        if (!account) break;
        this.emit("systemEvent", {
          type: "system_event",
          event: "provider_status",
          payload: {
            account,
          },
          raw: msg,
        } as SystemEventMessage);
        break;
      }

      case "app/list/updated": {
        const apps = getStringArray(params.apps ?? params.items);
        this.emit("systemEvent", {
          type: "system_event",
          event: "provider_status",
          payload: {
            apps,
          },
          raw: msg,
        } as SystemEventMessage);
        break;
      }

      // -----------------------------------------------------------------------
      // Errors
      // -----------------------------------------------------------------------
      case "error": {
        const error = params.error as { message?: string } | undefined;
        const willRetry = params.willRetry as boolean | undefined;
        const errorMessage = error?.message ?? "unknown";
        if (!willRetry) {
          this.logger.error(`[CodexAppServer] Error: ${errorMessage}`);
          this.emit("providerError", errorMessage);
        }
        break;
      }

      // -----------------------------------------------------------------------
      // Approval resolved (server tells us an approval was auto-resolved)
      // -----------------------------------------------------------------------
      case "serverRequest/resolved": {
        const resolvedId = params.requestId as string | number | undefined;
        if (resolvedId !== undefined) {
          this.pendingRequests.delete(`codex-approval-${resolvedId}`);
          this.pendingRequests.delete(`codex-input-${resolvedId}`);
          this.pendingRequests.delete(`codex-terminal-${resolvedId}`);
        }
        break;
      }

      case "model/rerouted": {
        this.emit("systemEvent", {
          type: "system_event",
          event: "model_rerouted",
          payload: {
            requestedModel: getString(params.requestedModel) ?? this._preferredModel ?? undefined,
            effectiveModel: getString(params.effectiveModel) ?? getString(params.model),
            reroutedFromModel:
              getString(params.reroutedFromModel) ?? getString(params.requestedModel),
            message: getString(params.message),
          },
          raw: msg,
        } as SystemEventMessage);
        break;
      }

      case "configWarning":
      case "deprecationNotice": {
        const notice = buildProviderNotice("warning", "global", msg.method, params);
        if (!notice) break;
        this.emit("systemEvent", {
          type: "system_event",
          event: "provider_notice",
          payload: notice as unknown as Record<string, unknown>,
          raw: msg,
        } as SystemEventMessage);
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
        if (dyn.tool === "request_user_input") break;
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
          trackFileChange(this.fileMap, this.cwd, change.path, changeType);
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
        if (dyn.tool === "request_user_input") break;
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

  private finishTurn(raw?: unknown): void {
    if (!this._isProcessing) return;
    this.clearTimeout();
    this._isProcessing = false;
    this._currentTurnId = null;

    // If plan deltas were accumulated, feed them as a <proposed_plan> block
    // so the parser emits an ExitPlanMode activity for the plan-review flow.
    const prePlanMessages: Array<OutputMessage | ActivityMessage> = [];
    if (this._planDeltaBuffer) {
      const planContent = this._planDeltaBuffer.trim();
      this._planDeltaBuffer = "";
      if (planContent && planContent !== this._lastEmittedPlan) {
        this.logger.info(
          `[CodexAppServer] finishTurn: wrapping ${planContent.length} chars of plan deltas as <proposed_plan>`,
        );
        this._lastEmittedPlan = planContent;
        prePlanMessages.push(
          ...this.proposedPlanParser.push(`<proposed_plan>${planContent}</proposed_plan>`, raw),
        );
      }
    }

    const planMessages = [...prePlanMessages, ...this.proposedPlanParser.finish(raw)];
    for (const message of planMessages) {
      if (message.type === "output") {
        this.emit("output", message as OutputMessage);
      } else {
        const act = message as ActivityMessage;
        if (act.tool === "ExitPlanMode") {
          this.logger.info("[CodexAppServer] finishTurn: emitting ExitPlanMode activity");
        }
        this.emit("activity", act);
      }
    }

    // Flush any message that was queued while processing
    if (this._pendingMessage) {
      const queued = this._pendingMessage;
      this._pendingMessage = null;
      this.send(queued);
    }
  }

  private emitCompactionEvent(turnId: string, raw?: unknown): void {
    if (this._lastCompactionTurnId === turnId) return;
    this._lastCompactionTurnId = turnId;
    this.emit("systemEvent", {
      type: "system_event",
      event: "compact_boundary",
      payload: {
        threadId: this._sessionId,
        turnId,
      },
      raw,
    } as SystemEventMessage);
  }

  private emitSessionInitEvent(raw?: unknown): void {
    this.emit(
      "systemEvent",
      buildSessionInitEvent(raw, {
        sessionId: this._sessionId,
        cwd: this.cwd,
        model: this._preferredModel ?? undefined,
      }),
    );
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

  private hasWritableTransport(): boolean {
    return !!this.process?.stdin?.writable;
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private resolveApprovalPolicy(): string {
    if (this._planMode) return "on-failure";
    if (this._bypassPermissions) return "never";
    // "on-failure" is the default — approve commands, ask on failure
    // "untrusted" means ask for everything
    return "on-failure";
  }

  private resolveSandboxMode(): string {
    if (this._planMode) return "workspace-write";
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

export async function fetchCodexProviderGlobalStateSnapshot({
  cwd,
  logger,
  processTimeout = 10_000,
  spawnProcess = spawn,
  codexPath = findCodexBinary() ?? "codex",
}: CodexProviderGlobalStateSnapshotOptions): Promise<import("#core/types.js").ProviderGlobalState> {
  const child = spawnProcess(codexPath, ["app-server", "--listen", "stdio://"], {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdin = child.stdin;
  const stdout = child.stdout;
  if (!stdin?.writable || !stdout) {
    child.kill("SIGTERM");
    throw new Error("Codex app-server transport unavailable");
  }

  let nextRpcId = 1;
  let lineBuffer = "";
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  const cleanup = () => {
    stdout.removeAllListeners("data");
    child.removeAllListeners();
  };

  const closeChild = () => {
    cleanup();
    if (!child.killed) child.kill("SIGTERM");
  };

  const rejectAll = (error: Error) => {
    for (const [, entry] of pending) {
      entry.reject(error);
    }
    pending.clear();
  };

  child.on("error", (err) => {
    rejectAll(err instanceof Error ? err : new Error(String(err)));
  });
  child.on("close", (code, signal) => {
    if (pending.size > 0) {
      rejectAll(new Error(`Codex app-server exited (${code ?? signal ?? "unknown"})`));
    }
  });

  stdout.on("data", (chunk: Buffer | string) => {
    lineBuffer += chunk.toString();
    let idx = lineBuffer.indexOf("\n");
    while (idx !== -1) {
      const line = lineBuffer.slice(0, idx).trim();
      lineBuffer = lineBuffer.slice(idx + 1);
      idx = lineBuffer.indexOf("\n");
      if (!line) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        if ("id" in msg && msg.id !== undefined && !("method" in msg)) {
          const id = typeof msg.id === "number" ? msg.id : Number(msg.id);
          const entry = pending.get(id);
          if (!entry) continue;
          pending.delete(id);
          if (msg.error) {
            entry.reject(
              new Error(msg.error.message ?? `RPC error ${msg.error.code ?? "unknown"}`),
            );
          } else {
            entry.resolve(msg.result);
          }
        }
      } catch {
        logger.debug(`[CodexAppServer] Snapshot fetch ignoring non-JSON line: ${line}`);
      }
    }
  });

  const sendRpc = (method: string, params: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextRpcId++;
      pending.set(id, { resolve, reject });
      stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });

  const sendNotification = (method: string, params?: unknown): void => {
    const msg: { jsonrpc: "2.0"; method: string; params?: unknown } = { jsonrpc: "2.0", method };
    if (params !== undefined) msg.params = params;
    stdin.write(JSON.stringify(msg) + "\n");
  };

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("Timed out fetching Codex global state")), processTimeout);
  });

  try {
    await Promise.race([
      sendRpc("initialize", {
        clientInfo: { name: "relay", version: "0.0.0" },
        capabilities: { experimentalApi: true },
      }),
      timeout,
    ]);
    sendNotification("initialized");

    const [mcpResult, appResult, accountResult, rateLimitsResult] = await Promise.all([
      Promise.race([sendRpc("mcpServerStatus/list", {}), timeout]).catch(() => null),
      Promise.race([sendRpc("app/list", {}), timeout]).catch(() => null),
      Promise.race([sendRpc("account/read", { refreshToken: false }), timeout]).catch(() => null),
      Promise.race([sendRpc("account/rateLimits/read", undefined), timeout]).catch(() => null),
    ]);

    const mcpPayload = asRecord(mcpResult);
    const appPayload = asRecord(appResult);
    const account = normalizeCodexAccountSnapshot(accountResult) ?? undefined;
    const rateLimits = normalizeCodexRateLimitsSnapshot(rateLimitsResult);

    return {
      provider: "codex",
      account:
        account || rateLimits?.length
          ? {
              ...(account ?? {}),
              rateLimits,
            }
          : undefined,
      mcpServers: buildMcpServerStatusList(mcpPayload?.servers ?? mcpPayload?.items ?? mcpResult),
      apps: getStringArray(appPayload?.apps ?? appPayload?.items ?? appResult),
      updatedAt: Date.now(),
    };
  } finally {
    closeChild();
  }
}
