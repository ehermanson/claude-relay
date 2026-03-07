/**
 * Provider Session Interface
 *
 * Abstracts managed session lifecycle so InstanceManager doesn't need to know
 * whether the backing implementation is the Agent SDK, the CLI, or Codex.
 *
 * Both ClaudeSdkSession and ClaudeProcess (CLI fallback) implement this interface.
 */

import { EventEmitter } from "events";
import type { OutputMessage, ExitMessage, ActivityMessage, SessionStats } from "./types.js";

// =============================================================================
// Events
// =============================================================================

export interface ProviderSessionEvents {
  output: [OutputMessage];
  exit: [ExitMessage];
  activity: [ActivityMessage];
  stats: [SessionStats];
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

  /** PID of the underlying process, if any. Used for discovery exclusion. */
  readonly pid: number | undefined;

  /** Change the model for subsequent turns. Pass null to clear. */
  setModel(model: string | null): void;

  /** Add a tool to the auto-allowed list (CLI: --allowedTools, SDK: updatedPermissions). */
  addAllowedTool(tool: string): void;

  /** Set the session ID (CLI provider discovers it post-hoc from JSONL). */
  setSessionId?(sessionId: string): void;

  /** Current accumulated token/cost stats. */
  readonly stats: SessionStats;

  /**
   * Approve a pending permission request (SDK only).
   * Resolves the deferred created by the canUseTool callback.
   * CLI provider does not use this — it uses addAllowedTool + retry.
   * Returns true if there was a pending request to approve.
   */
  approvePermission?(tool: string): boolean;
}
