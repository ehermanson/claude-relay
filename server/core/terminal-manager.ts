/**
 * TerminalManager — Terminal lifecycle management for Relay
 *
 * Manages embedded PTY terminals that are either:
 * - Space-scoped: shared across all chats in a space (persists for the space lifetime)
 * - Instance-scoped: tied to a single chat session
 *
 * Uses a pluggable PtyAdapterFactory so the PTY backend can be swapped.
 */

import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import type { PtyAdapterFactory, PtyProcess } from "#core/pty-adapter.js";
import type { TerminalInfo, TerminalScope } from "#core/types.js";
import type { Logger } from "#core/logger.js";

// ── Constants ────────────────────────────────────────────────────────

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const MAX_SCROLLBACK_BYTES = 512 * 1024; // 512 KB

// ── Internal terminal state ──────────────────────────────────────────

interface Terminal {
  info: TerminalInfo;
  pty: PtyProcess;
  scrollback: string[];
  scrollbackBytes: number;
}

// ── Events ───────────────────────────────────────────────────────────

export interface TerminalManagerEvents {
  "terminal:created": [terminal: TerminalInfo];
  "terminal:output": [terminalId: string, data: string];
  "terminal:exit": [terminalId: string, code: number, signal?: string];
  "terminal:removed": [terminalId: string];
}

export interface TerminalManager {
  on<E extends keyof TerminalManagerEvents>(
    event: E,
    listener: (...args: TerminalManagerEvents[E]) => void,
  ): this;
  emit<E extends keyof TerminalManagerEvents>(event: E, ...args: TerminalManagerEvents[E]): boolean;
  off<E extends keyof TerminalManagerEvents>(
    event: E,
    listener: (...args: TerminalManagerEvents[E]) => void,
  ): this;
}

function scopeKey(scope: TerminalScope): string {
  return scope.type === "space" ? `space:${scope.spaceId}` : `instance:${scope.instanceId}`;
}

// ── TerminalManager ──────────────────────────────────────────────────

export class TerminalManager extends EventEmitter {
  private terminals = new Map<string, Terminal>();
  private ptyFactory: PtyAdapterFactory;
  private log: Logger;

  constructor(ptyFactory: PtyAdapterFactory, log: Logger) {
    super();
    this.ptyFactory = ptyFactory;
    this.log = log;
  }

  /**
   * Create a new terminal session.
   */
  createTerminal(options: {
    scope: TerminalScope;
    cwd: string;
    cols?: number;
    rows?: number;
  }): TerminalInfo {
    const id = randomUUID().replace(/-/g, "").slice(0, 12);
    const cols = options.cols ?? DEFAULT_COLS;
    const rows = options.rows ?? DEFAULT_ROWS;

    const pty = this.ptyFactory({
      cwd: options.cwd,
      cols,
      rows,
    });

    const info: TerminalInfo = {
      id,
      scope: options.scope,
      cwd: options.cwd,
      cols,
      rows,
      createdAt: Date.now(),
      exited: false,
    };

    const terminal: Terminal = {
      info,
      pty,
      scrollback: [],
      scrollbackBytes: 0,
    };

    this.terminals.set(id, terminal);

    // Wire PTY events
    pty.on("data", (data: string) => {
      this.appendScrollback(terminal, data);
      this.emit("terminal:output", id, data);
    });

    pty.on("exit", (code: number, signal?: string) => {
      terminal.info.exited = true;
      terminal.info.exitCode = code;
      this.log.info(`Terminal ${id} exited (code=${code}, signal=${signal ?? "none"})`);
      this.emit("terminal:exit", id, code, signal);
    });

    this.log.info(`Terminal ${id} created (scope=${scopeKey(options.scope)}, cwd=${options.cwd})`);
    this.emit("terminal:created", info);
    return info;
  }

  /**
   * Write data to a terminal's PTY stdin.
   */
  writeTerminal(terminalId: string, data: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;
    terminal.pty.write(data);
  }

  /**
   * Resize a terminal's PTY.
   */
  resizeTerminal(terminalId: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;
    terminal.pty.resize(cols, rows);
    terminal.info.cols = cols;
    terminal.info.rows = rows;
  }

  /**
   * Close and remove a terminal.
   */
  closeTerminal(terminalId: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;

    if (!terminal.info.exited) {
      terminal.pty.kill();
    }
    this.terminals.delete(terminalId);
    this.log.info(`Terminal ${terminalId} closed`);
    this.emit("terminal:removed", terminalId);
  }

  /**
   * Get terminal info by ID.
   */
  getTerminal(terminalId: string): TerminalInfo | undefined {
    return this.terminals.get(terminalId)?.info;
  }

  /**
   * Get the scrollback buffer for a terminal (for reconnect replay).
   */
  getScrollback(terminalId: string): string {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return "";
    return terminal.scrollback.join("");
  }

  /**
   * List all terminals, optionally filtered by scope.
   */
  listTerminals(scope?: TerminalScope): TerminalInfo[] {
    const all = Array.from(this.terminals.values()).map((t) => t.info);
    if (!scope) return all;
    const key = scopeKey(scope);
    return all.filter((t) => scopeKey(t.scope) === key);
  }

  /**
   * Close all terminals for a given scope (e.g. when a space is deleted).
   */
  closeAllForScope(scope: TerminalScope): void {
    const key = scopeKey(scope);
    for (const [id, terminal] of this.terminals) {
      if (scopeKey(terminal.info.scope) === key) {
        this.closeTerminal(id);
      }
    }
  }

  /**
   * Close all terminals. Called during server shutdown.
   */
  closeAll(): void {
    for (const id of Array.from(this.terminals.keys())) {
      this.closeTerminal(id);
    }
  }

  // ── Private ──────────────────────────────────────────────────────

  private appendScrollback(terminal: Terminal, data: string): void {
    terminal.scrollback.push(data);
    terminal.scrollbackBytes += data.length;

    // Trim old scrollback when we exceed the limit
    while (terminal.scrollbackBytes > MAX_SCROLLBACK_BYTES && terminal.scrollback.length > 1) {
      const removed = terminal.scrollback.shift()!;
      terminal.scrollbackBytes -= removed.length;
    }
  }
}
