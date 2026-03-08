/**
 * Provider Session Interface
 *
 * Abstracts managed session lifecycle so InstanceManager doesn't need to know
 * whether the backing implementation is the Agent SDK, the CLI, or Codex.
 *
 * Both ClaudeSdkSession and ClaudeProcess (CLI fallback) implement this interface.
 */

import { EventEmitter } from "events";
import type {
  OutputMessage,
  ExitMessage,
  ActivityMessage,
  SessionStats,
  ProviderKind,
  ProviderRequest,
  ProviderRuntimeBinding,
} from "./types.js";

// =============================================================================
// Events
// =============================================================================

export interface ProviderSessionEvents {
  output: [OutputMessage];
  exit: [ExitMessage];
  activity: [ActivityMessage];
  stats: [SessionStats];
  /** Emitted when the SDK's canUseTool callback needs user approval (not a chat activity). */
  permissionRequest: [ProviderRequest];
}

// =============================================================================
// Interface
// =============================================================================

export interface ProviderSession extends EventEmitter {
  on<E extends keyof ProviderSessionEvents>(
    event: E,
    listener: (...args: ProviderSessionEvents[E]) => void,
  ): this;
  emit<E extends keyof ProviderSessionEvents>(event: E, ...args: ProviderSessionEvents[E]): boolean;
  off<E extends keyof ProviderSessionEvents>(
    event: E,
    listener: (...args: ProviderSessionEvents[E]) => void,
  ): this;

  /** Send a user message. For SDK providers this pushes to the prompt queue; for CLI it spawns a process. */
  send(message: string): void;

  /** Interrupt the current turn (SIGINT for CLI, query.interrupt() for SDK). */
  interrupt(): void;

  /** Kill/close the session and release all resources. */
  close(): void;

  /** Whether a turn is currently active. */
  readonly isProcessing: boolean;

  /** Provider kind implemented by this session. */
  readonly provider: ProviderKind;

  /** PID of the underlying process, if any. Used for discovery exclusion. */
  readonly pid: number | undefined;

  /** Change the model for subsequent turns. Pass null to clear. */
  setModel(model: string | null): void;

  /** Change the reasoning budget for subsequent turns. Pass null to clear. */
  setReasoningBudget(budget: number | null): void;

  /** Add a tool to the auto-allowed list (CLI: --allowedTools, SDK: updatedPermissions). */
  addAllowedTool(tool: string): void;

  /** Toggle bypass-all-permissions mode at runtime. */
  setBypassPermissions(bypass: boolean): void;

  /** Set the provider session ID (CLI provider discovers it post-hoc from transcripts). */
  setSessionId?(sessionId: string): void;

  /** Current accumulated token/cost stats. */
  readonly stats: SessionStats;

  /** Provider-owned runtime state used to restore a managed session. */
  getRuntimeBinding(): ProviderRuntimeBinding;

  /**
   * Resolve a pending provider request (SDK only for now).
   * Returns true if the request was found and handled.
   */
  respondToRequest?(requestId: string, decision: "accept" | "decline"): boolean;
}
