/**
 * PtyAdapter — Abstract PTY interface for Relay
 *
 * Decouples the terminal manager from the PTY implementation so
 * the backend can be swapped (node-pty, Bun.Terminal, mock, SSH, etc.)
 * without changing the terminal lifecycle code.
 */

import { EventEmitter } from "events";

// ── PtyProcess ───────────────────────────────────────────────────────

export interface PtyProcessEvents {
  data: [data: string];
  exit: [code: number, signal?: string];
}

export interface PtyProcess {
  on<E extends keyof PtyProcessEvents>(
    event: E,
    listener: (...args: PtyProcessEvents[E]) => void,
  ): this;
  off<E extends keyof PtyProcessEvents>(
    event: E,
    listener: (...args: PtyProcessEvents[E]) => void,
  ): this;
  emit<E extends keyof PtyProcessEvents>(event: E, ...args: PtyProcessEvents[E]): boolean;

  /** Write data to the PTY stdin. */
  write(data: string): void;
  /** Resize the PTY. */
  resize(cols: number, rows: number): void;
  /** Kill the PTY process. */
  kill(signal?: string): void;

  /** PID of the child process. */
  readonly pid: number;
}

// ── PtySpawnOptions ──────────────────────────────────────────────────

export interface PtySpawnOptions {
  /** Shell binary to spawn (defaults to user's $SHELL or /bin/bash). */
  shell?: string;
  /** Working directory for the shell. */
  cwd: string;
  /** Initial column count. */
  cols: number;
  /** Initial row count. */
  rows: number;
  /** Extra environment variables to merge into the process env. */
  env?: Record<string, string>;
}

// ── PtyAdapterFactory ────────────────────────────────────────────────

/**
 * A factory function that creates PtyProcess instances.
 * Injected into TerminalManager to keep the PTY backend swappable.
 */
export type PtyAdapterFactory = (options: PtySpawnOptions) => PtyProcess;

// ── Base PtyProcess implementation ───────────────────────────────────

/**
 * Convenience base class that adapters can extend.
 * Provides typed EventEmitter so implementations only need to fill in
 * write(), resize(), kill(), and pid.
 */
export abstract class BasePtyProcess extends EventEmitter implements PtyProcess {
  abstract write(data: string): void;
  abstract resize(cols: number, rows: number): void;
  abstract kill(signal?: string): void;
  abstract readonly pid: number;
}
