/**
 * Claude SDK Session Provider
 *
 * Wraps @anthropic-ai/claude-agent-sdk's query() function to implement
 * the ProviderSession interface. Replaces the process-per-message CLI approach
 * with a long-lived session using an async iterable prompt queue.
 *
 * Key differences from CLI provider:
 * - Single query() call per session (multi-turn via prompt queue)
 * - canUseTool callback for permissions (no SIGINT + retry dance)
 * - Typed SDKMessage stream (no JSONL line parsing)
 * - Immediate session ID (no captureSessionId scanning)
 * - Live model/permission switching (no process restart)
 */

import { EventEmitter } from "events";
import type {
  OutputMessage,
  ExitMessage,
  ActivityMessage,
  TaskItem,
  FileChange,
  SessionStats,
  ProviderRequest,
  ProviderRuntimeBinding,
  UserInputQuestion,
} from "../types.js";
import type { CoreConfig } from "../config.js";
import type { ProviderSession, ProviderSessionEvents } from "../provider.js";
import {
  describeToolUse,
  describeToolDetail,
  extractInputDescription,
  getContextWindow,
  TASK_TOOLS,
  FILE_WRITE_TOOLS,
} from "../tools.js";
import { isPathWithinWorkspace } from "../workspace-paths.js";

// =============================================================================
// SDK Types — imported dynamically to avoid hard dep at module level
// =============================================================================

// Re-declare the subset of SDK types we need. The actual SDK is imported
// dynamically in create() so the module doesn't fail if the SDK isn't installed.
// These mirror @anthropic-ai/claude-agent-sdk's exports.

interface SDKUserMessage {
  type: "user";
  message: { role: "user"; content: Array<{ type: "text"; text: string }> };
  parent_tool_use_id: null;
  session_id: string;
}

interface SDKMessageBase {
  type: string;
  uuid?: string;
  session_id?: string;
}

/** Minimal subset of the Query interface we use */
interface QueryHandle extends AsyncIterable<SDKMessageBase> {
  interrupt(): Promise<void>;
  setPermissionMode(
    mode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk",
  ): Promise<void>;
  setModel(model?: string): Promise<void>;
  setMaxThinkingTokens(maxThinkingTokens: number | null): Promise<void>;
  close(): void;
}

type CanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    signal: AbortSignal;
    suggestions?: Array<{ type: string; [key: string]: unknown }>;
    toolUseID: string;
    agentID?: string;
    decisionReason?: string;
  },
) => Promise<
  | {
      behavior: "allow";
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: Array<{ type: string; [key: string]: unknown }>;
    }
  | { behavior: "deny"; message: string; interrupt?: boolean }
>;

interface SDKOptions {
  cwd?: string;
  model?: string;
  resume?: string;
  resumeSessionAt?: string;
  permissionMode?: string;
  allowDangerouslySkipPermissions?: boolean;
  includePartialMessages?: boolean;
  canUseTool?: CanUseTool;
  env?: Record<string, string | undefined>;
  allowedTools?: string[];
  maxThinkingTokens?: number;
  pathToClaudeCodeExecutable?: string;
}

type QueryFn = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>;
  options?: SDKOptions;
}) => QueryHandle;

// =============================================================================
// Prompt Queue
// =============================================================================

/**
 * Simple async iterable backed by an array + resolver queue.
 * push() enqueues a message; terminate() signals end of iteration.
 */
class PromptQueue implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private resolvers: Array<(value: IteratorResult<SDKUserMessage>) => void> = [];
  private done = false;

  push(message: SDKUserMessage): void {
    if (this.done) return;
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({ done: false, value: message });
    } else {
      this.queue.push(message);
    }
  }

  terminate(): void {
    if (this.done) return;
    this.done = true;
    for (const resolver of this.resolvers.splice(0)) {
      resolver({ done: true, value: undefined as unknown as SDKUserMessage });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const queued = this.queue.shift();
        if (queued) return Promise.resolve({ done: false as const, value: queued });
        if (this.done)
          return Promise.resolve({
            done: true as const,
            value: undefined as unknown as SDKUserMessage,
          });
        return new Promise((resolve) => {
          this.resolvers.push(resolve);
        });
      },
    };
  }
}

// =============================================================================
// Pending Permission
// =============================================================================

interface PendingPermission {
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  suggestions?: Array<{ type: string; [key: string]: unknown }>;
  resolve: (
    result:
      | {
          behavior: "allow";
          updatedInput?: Record<string, unknown>;
          updatedPermissions?: Array<{ type: string; [key: string]: unknown }>;
        }
      | { behavior: "deny"; message: string; interrupt?: boolean },
  ) => void;
}

interface PendingStreamMessage {
  textByIndex: Map<number, string>;
  textOrder: number[];
  hasToolUse: boolean;
  hasThinking: boolean;
}

// =============================================================================
// Tool / State Tracking
// =============================================================================

/** Max auto-continue attempts per user message to prevent runaway loops */
const MAX_AUTO_CONTINUES = 25;

// =============================================================================
// ClaudeSdkSession
// =============================================================================

export interface ClaudeSdkSessionOptions {
  /** Working directory for the session */
  cwd: string;
  /** Model to use (e.g. "claude-opus-4-6") */
  model?: string;
  /** Maximum extended-thinking token budget */
  maxThinkingTokens?: number;
  /** Whether Claude should run in plan mode */
  planMode?: boolean;
  /** Session ID to resume */
  resumeSessionId?: string;
  /** Whether to bypass all permissions */
  dangerouslySkipPermissions?: boolean;
  /** Logger from CoreConfig */
  logger: CoreConfig["logger"];
  /** Process timeout in ms (0 = no timeout) */
  processTimeout?: number;
  /** Pre-approved tools from a previous session */
  allowedTools?: string[];
  /** Injected query function (for testing) */
  queryFn?: QueryFn;
}

export interface ClaudeSdkSession extends ProviderSession {
  /** The session ID assigned by the SDK (available after first message from stream) */
  readonly sessionId: string | undefined;
}

/** Cached query function from the SDK — resolved once, reused for all sessions. */
let cachedQueryFn: QueryFn | null = null;

/**
 * Resolve the SDK's `query` function via dynamic import.
 * Caches the result so subsequent calls are synchronous.
 * Call this once at startup (e.g. in InstanceManager.restoreInstances())
 * so that session creation can be synchronous.
 */
export async function resolveQueryFn(): Promise<QueryFn> {
  if (cachedQueryFn) return cachedQueryFn;
  try {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    cachedQueryFn = sdk.query as unknown as QueryFn;
    return cachedQueryFn;
  } catch (err) {
    throw new Error(
      `@anthropic-ai/claude-agent-sdk is not installed. Install it with: npm install @anthropic-ai/claude-agent-sdk\n${err}`,
    );
  }
}

/**
 * Create a ClaudeSdkSession synchronously using a pre-resolved queryFn.
 * Use `resolveQueryFn()` to obtain the queryFn, or pass one directly for tests.
 */
export function createSdkSessionSync(
  options: ClaudeSdkSessionOptions,
  queryFn: QueryFn,
): ClaudeSdkSession {
  return new ClaudeSdkSessionImpl(options, queryFn);
}

/**
 * Create a ClaudeSdkSession.
 *
 * Uses dynamic import of @anthropic-ai/claude-agent-sdk so the module
 * doesn't fail if the SDK isn't installed. Falls back to provided queryFn
 * for testing.
 */
export async function createSdkSession(
  options: ClaudeSdkSessionOptions,
): Promise<ClaudeSdkSession> {
  const queryFn = options.queryFn ? options.queryFn : await resolveQueryFn();
  return new ClaudeSdkSessionImpl(options, queryFn);
}

class ClaudeSdkSessionImpl extends EventEmitter implements ClaudeSdkSession {
  private _isProcessing = false;
  private _hasStreamedText = false;
  private _lastMessageHadToolUse = false;
  private _sessionId: string | undefined;
  private _stopped = false;
  private _stats: SessionStats = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };

  private promptQueue: PromptQueue;
  private query: QueryHandle;
  private pendingPermission: PendingPermission | null = null;
  private allowedToolSet: Set<string>;
  private _bypassPermissions = false;
  private _planMode = false;
  private pendingStreamMessage: PendingStreamMessage | null = null;
  private _autoContinueCount = 0;

  // State tracking (mirrors ClaudeProcess)
  private taskMap = new Map<string, TaskItem>();
  private pendingTaskCreates = new Map<string, { subject: string; activeForm?: string }>();
  private fileMap = new Map<string, FileChange>();
  // Map tool_use_id → tool name for tool_result attribution
  private pendingTools = new Map<string, string>();
  /** Raw assistant message for attaching to emitted events */
  private _lastRawAssistantMsg: Record<string, unknown> | null = null;

  private logger: CoreConfig["logger"];
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private cwd: string;
  private currentModel: string | null;

  constructor(options: ClaudeSdkSessionOptions, queryFn: QueryFn) {
    super();
    this.logger = options.logger;
    this.cwd = options.cwd;
    this.currentModel = options.model ?? null;
    this._planMode = options.planMode ?? false;
    this.allowedToolSet = new Set(options.allowedTools || []);
    this.promptQueue = new PromptQueue();

    // Build SDK options
    const sdkOptions: SDKOptions = {
      cwd: options.cwd,
      model: options.model,
      maxThinkingTokens: options.maxThinkingTokens,
      includePartialMessages: true,
      env: process.env as Record<string, string | undefined>,
    };

    if (options.resumeSessionId) {
      sdkOptions.resume = options.resumeSessionId;
    }

    if (options.dangerouslySkipPermissions) {
      this._bypassPermissions = true;
    }

    if (this._bypassPermissions) {
      sdkOptions.permissionMode = "bypassPermissions";
    } else if (this._planMode) {
      sdkOptions.permissionMode = "plan";
    }

    // Always set canUseTool so we can toggle bypass at runtime.
    // When bypass is on, the callback auto-approves everything.
    sdkOptions.canUseTool = this.handleCanUseTool.bind(this);

    if (this.allowedToolSet.size > 0) {
      sdkOptions.allowedTools = [...this.allowedToolSet];
    }

    this.logger.info(
      `[SdkSession] Starting session in ${options.cwd}${options.resumeSessionId ? ` (resume: ${options.resumeSessionId})` : ""}`,
    );

    // Start the query — this spawns the Claude Code subprocess
    this.query = queryFn({
      prompt: this.promptQueue,
      options: sdkOptions,
    });

    // Start consuming the message stream
    this.consumeStream();
  }

  // ===========================================================================
  // ProviderSession interface
  // ===========================================================================

  get isProcessing(): boolean {
    return this._isProcessing;
  }

  get provider(): "claude" {
    return "claude";
  }

  get pid(): number | undefined {
    // SDK manages the subprocess internally — we don't have direct PID access.
    // Discovery exclusion will need to match by other means (CWD, timing).
    return undefined;
  }

  get stats(): SessionStats {
    return { ...this._stats };
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  getRuntimeBinding(): ProviderRuntimeBinding {
    return {
      provider: "claude",
      providerSessionId: this._sessionId,
      resumeCursor: this._sessionId ? { sessionId: this._sessionId } : undefined,
      runtimePayload: {
        cwd: this.cwd,
        model: this.currentModel ?? undefined,
      },
      runtimeMode: this._planMode
        ? "plan"
        : this._bypassPermissions
          ? "full-access"
          : "approval-required",
    };
  }

  send(message: string): void {
    if (this._stopped) {
      this.logger.warn("[SdkSession] Cannot send — session is stopped");
      return;
    }
    if (this._isProcessing) {
      this.logger.warn("[SdkSession] Already processing, ignoring message");
      return;
    }

    this._isProcessing = true;
    this._hasStreamedText = false;
    this._lastMessageHadToolUse = false;
    this._autoContinueCount = 0;
    this.logger.info(`[SdkSession] Sending: "${message.slice(0, 50)}..."`);

    const userMessage: SDKUserMessage = {
      type: "user",
      parent_tool_use_id: null,
      session_id: this._sessionId || "",
      message: {
        role: "user",
        content: [{ type: "text", text: message }],
      },
    };

    this.promptQueue.push(userMessage);

    // Reset timeout for this turn
    this.resetTimeout();
  }

  interrupt(): void {
    if (this._stopped) return;
    this.logger.info("[SdkSession] Interrupting...");
    this.query.interrupt().catch((err) => {
      this.logger.debug(`[SdkSession] Interrupt error (expected): ${err}`);
    });
  }

  close(): void {
    if (this._stopped) return;
    this._stopped = true;
    this.clearTimeout();
    this.promptQueue.terminate();

    // Reject any pending permission
    if (this.pendingPermission) {
      this.pendingPermission.resolve({ behavior: "deny", message: "Session closed" });
      this.pendingPermission = null;
    }

    try {
      this.query.close();
    } catch {
      // ignore — may already be closed
    }
    this.logger.info("[SdkSession] Closed");
  }

  setModel(model: string | null): void {
    if (this._stopped) return;
    this.currentModel = model;
    if (model) {
      this.query.setModel(model).catch((err) => {
        this.logger.warn(`[SdkSession] setModel error: ${err}`);
      });
    } else {
      this.query.setModel(undefined).catch((err) => {
        this.logger.warn(`[SdkSession] setModel(clear) error: ${err}`);
      });
    }
  }

  setReasoningBudget(budget: number | null): void {
    if (this._stopped) return;
    this.query.setMaxThinkingTokens(budget).catch((err) => {
      this.logger.warn(`[SdkSession] setMaxThinkingTokens error: ${err}`);
    });
  }

  addAllowedTool(tool: string): void {
    this.allowedToolSet.add(tool);
    // Note: SDK manages allowed tools via canUseTool callback + updatedPermissions.
  }

  setBypassPermissions(bypass: boolean): void {
    this._bypassPermissions = bypass;
    if (bypass) {
      this._planMode = false;
    }
    this.logger.info(`[SdkSession] Bypass permissions: ${bypass}`);
    this.query
      .setPermissionMode(bypass ? "bypassPermissions" : this._planMode ? "plan" : "default")
      .catch((err) => {
        this.logger.warn(`[SdkSession] setPermissionMode error: ${err}`);
      });
    // If switching to bypass and there's a pending permission, auto-approve it
    if (bypass && this.pendingPermission) {
      this.logger.info(
        `[SdkSession] Auto-approving pending permission for ${this.pendingPermission.toolName}`,
      );
      this.pendingPermission.resolve({
        behavior: "allow",
        updatedInput: this.pendingPermission.input,
        updatedPermissions: this.pendingPermission.suggestions,
      });
      this.pendingPermission = null;
    }
  }

  setPlanMode(planMode: boolean): void {
    if (this._stopped) return;
    this._planMode = planMode;
    if (planMode) {
      this._bypassPermissions = false;
    }
    this.query
      .setPermissionMode(
        planMode ? "plan" : this._bypassPermissions ? "bypassPermissions" : "default",
      )
      .catch((err) => {
        this.logger.warn(`[SdkSession] setPermissionMode(plan) error: ${err}`);
      });
  }

  respondToRequest(
    requestId: string,
    decision: "accept" | "decline",
    response?: import("../types.js").ProviderRequestResponse,
  ): boolean {
    if (!this.pendingPermission || this.pendingPermission.toolUseId !== requestId) return false;
    if (decision !== "accept") {
      this.pendingPermission.resolve({ behavior: "deny", message: "Request declined" });
      this.pendingPermission = null;
      return true;
    }

    const toolName = this.pendingPermission.toolName;
    this.logger.info(`[SdkSession] Approving permission for ${toolName}`);

    let updatedInput = this.pendingPermission.input;

    if (toolName === "AskUserQuestion" && response?.answers) {
      // Flatten Relay's { questionId: { answers: string[] } } format
      // to { questionId: string } for the SDK's built-in handler.
      const flatAnswers: Record<string, string> = {};
      for (const [questionId, answer] of Object.entries(response.answers)) {
        const values = answer?.answers?.filter((v) => typeof v === "string" && v.trim());
        if (values?.length) flatAnswers[questionId] = values.join(", ");
      }
      updatedInput = { ...updatedInput, answers: flatAnswers };
    } else {
      // Only add non-interactive tools to the pre-approved set.
      // AskUserQuestion must always prompt for user input.
      this.allowedToolSet.add(toolName);
    }

    this.pendingPermission.resolve({
      behavior: "allow",
      updatedInput,
      updatedPermissions: this.pendingPermission.suggestions,
    });
    this.pendingPermission = null;
    return true;
  }

  approvePermission(tool: string): boolean {
    if (!this.pendingPermission || this.pendingPermission.toolName !== tool) return false;
    return this.respondToRequest(this.pendingPermission.toolUseId, "accept");
  }

  // ===========================================================================
  // canUseTool callback
  // ===========================================================================

  private handleCanUseTool(
    toolName: string,
    input: Record<string, unknown>,
    callbackOptions: {
      signal: AbortSignal;
      suggestions?: Array<{ type: string; [key: string]: unknown }>;
      toolUseID: string;
    },
  ): Promise<
    | {
        behavior: "allow";
        updatedInput?: Record<string, unknown>;
        updatedPermissions?: Array<{ type: string; [key: string]: unknown }>;
      }
    | { behavior: "deny"; message: string; interrupt?: boolean }
  > {
    // AskUserQuestion always blocks — it needs user interaction regardless of
    // bypass/allowed status. We emit a "user_input" request (with questions)
    // so the UI renders the question panel instead of a permission banner.
    if (toolName === "AskUserQuestion") {
      const questions = Array.isArray(input?.questions)
        ? (input.questions as Record<string, unknown>[])
            .filter(
              (question) =>
                typeof question === "object" &&
                question !== null &&
                typeof question.question === "string",
            )
            .map(
              (question, index) =>
                ({
                  ...question,
                  // AskUserQuestion tool input doesn't include `id` — generate one
                  id: typeof question.id === "string" ? question.id : `q_${index}`,
                }) as UserInputQuestion,
            )
        : [];

      this.logger.info(
        `[SdkSession] AskUserQuestion: waiting for user input (${questions.length} questions)`,
      );
      const request: ProviderRequest = {
        requestId: callbackOptions.toolUseID,
        kind: "user_input",
        tool: "AskUserQuestion",
        description: questions[0]?.question,
        questions,
      };
      this.emit("permissionRequest", request);

      return new Promise((resolve) => {
        this.pendingPermission = {
          toolName,
          toolUseId: callbackOptions.toolUseID,
          input,
          suggestions: callbackOptions.suggestions,
          resolve,
        };

        callbackOptions.signal.addEventListener(
          "abort",
          () => {
            if (this.pendingPermission?.toolUseId === callbackOptions.toolUseID) {
              this.pendingPermission = null;
              resolve({ behavior: "deny", message: "Operation cancelled" });
            }
          },
          { once: true },
        );
      });
    }

    // If bypass mode is on, allow everything
    if (this._bypassPermissions) {
      return Promise.resolve({ behavior: "allow" as const, updatedInput: input });
    }

    // If tool is pre-approved, allow immediately
    if (this.allowedToolSet.has(toolName)) {
      return Promise.resolve({ behavior: "allow" as const, updatedInput: input });
    }

    // File-write group: if any file-write tool is approved, allow all
    if (
      FILE_WRITE_TOOLS.has(toolName) &&
      [...FILE_WRITE_TOOLS].some((t) => this.allowedToolSet.has(t))
    ) {
      this.allowedToolSet.add(toolName);
      return Promise.resolve({ behavior: "allow" as const, updatedInput: input });
    }

    this.logger.info(`[SdkSession] Permission requested for ${toolName}`);

    // Emit a permission request event (not an activity — doesn't appear in chat).
    // InstanceManager wires this to set pendingPermission on the instance info.
    const request: ProviderRequest = {
      requestId: callbackOptions.toolUseID,
      kind: "approval",
      tool: toolName,
      description: describeToolUse(toolName, input),
    };
    this.emit("permissionRequest", request);

    // Create a deferred promise that will be resolved by approvePermission()
    return new Promise((resolve) => {
      this.pendingPermission = {
        toolName,
        toolUseId: callbackOptions.toolUseID,
        input,
        suggestions: callbackOptions.suggestions,
        resolve,
      };

      // If the signal is aborted (e.g. session closed), deny
      callbackOptions.signal.addEventListener(
        "abort",
        () => {
          if (this.pendingPermission?.toolUseId === callbackOptions.toolUseID) {
            this.pendingPermission = null;
            resolve({ behavior: "deny", message: "Operation cancelled" });
          }
        },
        { once: true },
      );
    });
  }

  // ===========================================================================
  // Stream Consumer
  // ===========================================================================

  private async consumeStream(): Promise<void> {
    try {
      for await (const message of this.query) {
        if (this._stopped) break;
        this.handleMessage(message as unknown as Record<string, unknown>);
      }
    } catch (err) {
      if (!this._stopped) {
        this.logger.error(`[SdkSession] Stream error: ${err}`);
        const exit: ExitMessage = {
          type: "exit",
          code: 1,
          stderr: String(err),
        };
        this.emit("exit", exit);
      }
    } finally {
      if (!this._stopped) {
        this._stopped = true;
        this.clearTimeout();
        this.finishTurn();
        // Signal to InstanceManager that this session is no longer usable.
        // Without this, the instance stays "idle" but send() silently drops
        // messages, leaving the UI stuck on "working..." forever.
        const exit: ExitMessage = { type: "exit", code: 0 };
        this.emit("exit", exit);
      }
    }
  }

  // ===========================================================================
  // Message Handlers
  // ===========================================================================

  private handleMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string;

    // Capture session ID from any message that has one
    if (!this._sessionId && typeof msg.session_id === "string" && msg.session_id) {
      this._sessionId = msg.session_id;
      this.logger.debug(`[SdkSession] Captured session ID: ${this._sessionId}`);
    }

    switch (type) {
      case "system":
        this.handleSystem(msg);
        break;
      case "assistant":
        this.handleAssistant(msg);
        break;
      case "stream_event":
        this.handleStreamEvent(msg);
        break;
      case "result":
        this.handleResult(msg);
        break;
      case "user":
        // User message replay during resume — skip
        break;
      case "tool_progress":
        this.handleToolProgress(msg);
        break;
      case "tool_use_summary":
        // Informational — skip for now
        break;
      case "auth_status":
      case "rate_limit_event":
      case "prompt_suggestion":
        // Telemetry / informational — skip
        break;
      default:
        this.logger.debug(`[SdkSession] Unhandled message type: ${type}`);
    }
  }

  private handleSystem(msg: Record<string, unknown>): void {
    const subtype = msg.subtype as string;

    switch (subtype) {
      case "init":
        this.logger.debug(
          `[SdkSession] Init: model=${msg.model}, cwd=${msg.cwd}, tools=${(msg.tools as string[])?.length}`,
        );
        break;
      case "hook_started":
      case "hook_progress":
      case "hook_response":
        // Hook lifecycle — skip
        break;
      case "compact_boundary":
      case "status":
      case "elicitation_complete":
      case "local_command_output":
        // Lifecycle — skip
        break;
      default:
        this.logger.debug(`[SdkSession] Unhandled system subtype: ${subtype}`);
    }
  }

  private handleAssistant(msg: Record<string, unknown>): void {
    this._lastRawAssistantMsg = msg;
    const message = msg.message as
      | {
          content?: Array<{
            type: string;
            text?: string;
            thinking?: string;
            name?: string;
            id?: string;
            input?: Record<string, unknown>;
          }>;
          model?: string;
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
          };
        }
      | undefined;

    if (!message?.content) return;

    // Accumulate usage
    if (message.usage && message.model) {
      this.accumulateUsage(message.model, message.usage);
    }

    // Track whether this message contained tool_use for auto-continue fallback
    this._lastMessageHadToolUse = message.content.some((block) => block.type === "tool_use");

    for (const block of message.content) {
      if (block.type === "thinking" && block.thinking) {
        const activity: ActivityMessage = {
          type: "activity",
          activity: "thinking",
          description: "Reasoning...",
          detail: block.thinking.slice(0, 500) + (block.thinking.length > 500 ? "..." : ""),
        };
        this.emit("activity", activity);
      } else if (block.type === "tool_use" && block.name) {
        // Reset auto-continue counter on productive progress — the limit should
        // only fire on consecutive empty turns, not during active tool loops.
        this._autoContinueCount = 0;
        if (block.id) this.pendingTools.set(block.id, block.name);
        this.handleToolUse(block.name, block.input, block.id);
      } else if (block.type === "tool_result") {
        this.handleToolResult(block as unknown as Record<string, unknown>);
      } else if (block.type === "text" && block.text) {
        // Emit text only as a fallback when no streaming occurred.
        // With includePartialMessages, the SDK sends partial assistant messages
        // interleaved with stream_event deltas. If we emit text here while
        // streaming is active (pendingStreamMessage exists), flushPendingStreamText()
        // will also emit the accumulated text on message_stop → duplicate.
        // Suppress text when the same message also contains tool_use — the text
        // is typically just a preamble ("Let me check that") and would clutter the UI.
        if (!this._hasStreamedText && !this.pendingStreamMessage && !this._lastMessageHadToolUse) {
          this._hasStreamedText = true;
          const output: OutputMessage = {
            type: "output",
            text: block.text,
            isWaiting: false,
            raw: msg,
          };
          this.emit("output", output);
        }
      }
    }
  }

  private handleStreamEvent(msg: Record<string, unknown>): void {
    // stream_event contains partial/streaming content via event.delta
    const event = msg.event as Record<string, unknown> | undefined;
    if (!event) return;

    const eventType = event.type as string;

    if (eventType === "content_block_start") {
      const index = typeof event.index === "number" ? event.index : 0;
      const block = event.content_block as { type?: string } | undefined;
      const state = this.ensurePendingStreamMessage();
      if (block?.type === "text") {
        if (!state.textByIndex.has(index)) {
          state.textByIndex.set(index, "");
          state.textOrder.push(index);
        }
      } else if (block?.type === "tool_use") {
        state.hasToolUse = true;
      } else if (block?.type === "thinking") {
        state.hasThinking = true;
      }
    } else if (eventType === "content_block_delta") {
      const index = typeof event.index === "number" ? event.index : 0;
      const delta = event.delta as { type?: string; text?: string; thinking?: string } | undefined;
      if (!delta) return;

      if (delta.type === "text_delta" && delta.text) {
        const state = this.ensurePendingStreamMessage();
        if (!state.textByIndex.has(index)) {
          state.textByIndex.set(index, "");
          state.textOrder.push(index);
        }
        state.textByIndex.set(index, (state.textByIndex.get(index) || "") + delta.text);
      }
      if (delta.type === "thinking_delta" || delta.type === "signature_delta") {
        this.ensurePendingStreamMessage().hasThinking = true;
      }
      if (delta.type === "input_json_delta") {
        this.ensurePendingStreamMessage().hasToolUse = true;
      }
    } else if (eventType === "message_start") {
      // Message started — ensure we're in processing state and reset stream flag
      this._hasStreamedText = false;
      this.pendingStreamMessage = null;
      if (!this._isProcessing) {
        this._isProcessing = true;
      }
    } else if (eventType === "message_stop") {
      this.flushPendingStreamText();
    }
  }

  private handleResult(msg: Record<string, unknown>): void {
    const stopReason = msg.stop_reason as string | null;
    const numTurns = msg.num_turns as number | undefined;
    this.logger.info(
      `[SdkSession] Result: subtype=${msg.subtype}, stop_reason=${stopReason}, num_turns=${numTurns}, is_error=${msg.is_error}`,
    );

    // Extract usage from result
    const modelUsage = msg.modelUsage as
      | Record<
          string,
          {
            inputTokens: number;
            outputTokens: number;
            cacheReadInputTokens: number;
            cacheCreationInputTokens: number;
          }
        >
      | undefined;

    if (modelUsage) {
      for (const [model, usage] of Object.entries(modelUsage)) {
        this._stats.inputTokens += usage.inputTokens || 0;
        this._stats.outputTokens += usage.outputTokens || 0;
        this._stats.cacheReadTokens += usage.cacheReadInputTokens || 0;
        this._stats.cacheCreationTokens += usage.cacheCreationInputTokens || 0;
        this._stats.model = model;
        this.emit("stats", { ...this._stats });
      }
    }

    // Handle error results
    if (msg.subtype !== "success") {
      const errors = msg.errors as string[] | undefined;
      const stderr = errors?.join("\n") || undefined;
      if (stderr) {
        const exit: ExitMessage = {
          type: "exit",
          code: 1,
          stderr,
        };
        this.emit("exit", exit);
      }
      this.finishTurn();
      return;
    }

    // Auto-continue: if the turn ended with stop_reason "tool_use", it means
    // Claude was mid-agent-loop but the CLI subprocess ended the turn prematurely.
    // Push a continuation prompt to keep the work going.
    // Also continue when stop_reason is missing but the last message had tool_use
    // blocks — the SDK sometimes omits stop_reason when the subprocess exits.
    const shouldContinue =
      stopReason === "tool_use" || (stopReason == null && this._lastMessageHadToolUse);
    if (shouldContinue && this._autoContinueCount < MAX_AUTO_CONTINUES && !this._stopped) {
      this._autoContinueCount++;
      this.logger.info(
        `[SdkSession] Turn ended mid-tool-loop (stop_reason=${stopReason}) — auto-continuing (${this._autoContinueCount}/${MAX_AUTO_CONTINUES})`,
      );
      this.promptQueue.push({
        type: "user",
        parent_tool_use_id: null,
        session_id: this._sessionId || "",
        message: {
          role: "user",
          content: [{ type: "text", text: "Continue." }],
        },
      });
      return;
    }

    // Turn is complete — go idle
    if (shouldContinue) {
      this.logger.warn(
        `[SdkSession] Turn ended mid-tool-loop but auto-continue blocked (stop_reason=${stopReason}, count=${this._autoContinueCount}/${MAX_AUTO_CONTINUES}, stopped=${this._stopped})`,
      );
    }
    this.finishTurn();
  }

  private ensurePendingStreamMessage(): PendingStreamMessage {
    if (!this.pendingStreamMessage) {
      this.pendingStreamMessage = {
        textByIndex: new Map(),
        textOrder: [],
        hasToolUse: false,
        hasThinking: false,
      };
    }
    return this.pendingStreamMessage;
  }

  private flushPendingStreamText(): void {
    const pending = this.pendingStreamMessage;
    this.pendingStreamMessage = null;
    if (!pending) return;

    // Suppress streamed text when the message also contained tool_use blocks —
    // the text is typically just a preamble and would clutter the UI alongside
    // the tool activity entries.
    if (pending.hasToolUse) return;

    const text = pending.textOrder
      .sort((a, b) => a - b)
      .map((index) => pending.textByIndex.get(index) || "")
      .join("");
    if (!text) return;

    const output: OutputMessage = {
      type: "output",
      text,
      isWaiting: false,
    };
    this._hasStreamedText = true;
    this.emit("output", output);
  }

  private handleToolProgress(msg: Record<string, unknown>): void {
    const toolName = msg.tool_name as string;
    const elapsed = msg.elapsed_time_seconds as number;

    if (toolName === "Bash" || toolName === "bash") {
      const activity: ActivityMessage = {
        type: "activity",
        activity: "tool_use",
        tool: "Bash",
        description: `Running... ${Math.round(elapsed)}s`,
      };
      this.emit("activity", activity);
    }
  }

  // ===========================================================================
  // Tool Handling (mirrors ClaudeProcess logic)
  // ===========================================================================

  private handleToolUse(
    toolName: string,
    input: Record<string, unknown> | undefined,
    toolUseId: string | undefined,
  ): void {
    // Task tools
    if (TASK_TOOLS.has(toolName)) {
      if (toolName === "TodoWrite" && input) {
        this.applyTodoWrite(input);
      } else if (toolName === "TaskCreate" && input && toolUseId) {
        this.pendingTaskCreates.set(toolUseId, {
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
      // TaskList/TaskGet: suppress
      return;
    }

    // File change tracking
    this.trackFileChange(toolName, input);

    const activityInput =
      toolName === "AskUserQuestion" && toolUseId
        ? { ...(input ?? {}), requestId: toolUseId }
        : input;

    // Note: AskUserQuestion user_input permissionRequest is emitted from
    // handleCanUseTool (which always blocks for this tool). No duplicate here.

    // Regular tool use activity
    const activity: ActivityMessage = {
      type: "activity",
      activity: "tool_use",
      tool: toolName,
      description: describeToolUse(toolName, input),
      detail: describeToolDetail(toolName, input),
      input: activityInput,
      inputDescription: extractInputDescription(toolName, input),
      raw: { tool: toolName, toolUseId, input: activityInput },
    };
    this.emit("activity", activity);
  }

  private handleToolResult(block: Record<string, unknown>): void {
    const toolUseId = block.tool_use_id as string;
    const toolName = this.pendingTools.get(toolUseId);
    const isError = block.is_error as boolean | undefined;

    if (TASK_TOOLS.has(toolName || "")) {
      if (toolName === "TaskCreate") {
        const content = (block.content as string) || "";
        const idMatch = content.match(/Task #(\d+)/);
        const pending = this.pendingTaskCreates.get(toolUseId);
        if (idMatch && pending) {
          this.taskMap.set(idMatch[1], {
            id: idMatch[1],
            subject: pending.subject,
            status: "pending",
            activeForm: pending.activeForm,
          });
          this.pendingTaskCreates.delete(toolUseId);
          this.emitTaskList();
        }
      }
      return;
    }

    // For non-task tools, emit a tool_result activity
    const content = typeof block.content === "string" ? block.content : "";
    const activity: ActivityMessage = {
      type: "activity",
      activity: "tool_result",
      description: isError ? "Tool error" : "Tool completed",
      tool: toolName,
      detail: content.slice(0, 200) || undefined,
      raw: { tool_use_id: toolUseId, tool: toolName, content: block.content, is_error: isError },
    };
    this.emit("activity", activity);
  }

  // ===========================================================================
  // State tracking helpers (mirrors ClaudeProcess)
  // ===========================================================================

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
    if (!isPathWithinWorkspace(this.cwd, filePath)) return;
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
    this._stats.model = model;
    // Snapshot total input for this turn = current context window utilization (not cumulative)
    this._stats.contextTokens =
      u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    if (!this._stats.contextWindow) {
      this._stats.contextWindow = getContextWindow(model);
    }
    this.emit("stats", { ...this._stats });
  }

  // ===========================================================================
  // Lifecycle helpers
  // ===========================================================================

  private finishTurn(): void {
    this.clearTimeout();
    this._isProcessing = false;
    const done: OutputMessage = {
      type: "output",
      text: "",
      isWaiting: true,
      raw: this._lastRawAssistantMsg ?? undefined,
    };
    this._lastRawAssistantMsg = null;
    this.emit("output", done);
  }

  private resetTimeout(): void {
    // Note: processTimeout only applies to the CLI fallback.
    // The SDK has its own timeout handling. We keep a generous safety net.
    // Not implemented for SDK sessions — the SDK handles timeouts internally.
  }

  private clearTimeout(): void {
    if (this.timeoutHandle) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }
}
