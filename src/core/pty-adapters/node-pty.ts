/**
 * NodePtyAdapter — node-pty implementation of PtyAdapter
 *
 * Wraps the node-pty library in Relay's PtyProcess interface.
 * This is the default (and currently only) PTY backend.
 */

import { existsSync, chmodSync, readdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { createRequire } from "module";
import { BasePtyProcess, type PtyAdapterFactory, type PtySpawnOptions } from "../pty-adapter.js";

// Dynamic import avoids hard-crashing if node-pty isn't installed
let nodePtyModule: typeof import("node-pty") | null = null;

async function loadNodePty(): Promise<typeof import("node-pty")> {
  if (!nodePtyModule) {
    nodePtyModule = await import("node-pty");
  }
  return nodePtyModule;
}

/** Environment variables to strip from PTY processes. */
const ENV_BLOCKLIST = new Set([
  "PORT",
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_RENDERER_PORT",
  "NODE_CHANNEL_FD",
  "NODE_CHANNEL_SERIALIZATION_MODE",
]);

/** Fallback shells to try when $SHELL is unavailable or invalid. */
const UNIX_SHELL_FALLBACKS = ["/bin/zsh", "/bin/bash", "/bin/sh"];

function resolveShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "cmd.exe";
  }

  // Try $SHELL first
  const envShell = process.env.SHELL;
  if (envShell && existsSync(envShell)) {
    return envShell;
  }

  // Fallback chain
  for (const shell of UNIX_SHELL_FALLBACKS) {
    if (existsSync(shell)) {
      return shell;
    }
  }

  // Last resort
  return "/bin/sh";
}

function resolveShellArgs(shell: string): string[] {
  const name = shell.split("/").pop() ?? "";
  // Login shell for common shells
  if (["bash", "zsh", "fish", "sh", "ksh"].includes(name)) {
    return ["-l"];
  }
  return [];
}

/**
 * Resolve a valid working directory.
 * Falls back to home directory if the given cwd doesn't exist.
 */
function resolveCwd(cwd: string): string {
  if (cwd && existsSync(cwd)) return cwd;
  const home = homedir();
  if (existsSync(home)) return home;
  return "/";
}

function buildEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !ENV_BLOCKLIST.has(key)) {
      env[key] = value;
    }
  }
  env.TERM = "xterm-256color";
  env.COLORTERM = "truecolor";
  if (extra) {
    Object.assign(env, extra);
  }
  return env;
}

class NodePtyProcess extends BasePtyProcess {
  private pty: import("node-pty").IPty;

  get pid(): number {
    return this.pty.pid;
  }

  constructor(pty: import("node-pty").IPty) {
    super();
    this.pty = pty;

    this.pty.onData((data: string) => {
      this.emit("data", data);
    });

    this.pty.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
      this.emit("exit", exitCode, signal !== undefined ? String(signal) : undefined);
    });
  }

  write(data: string): void {
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    try {
      this.pty.resize(cols, rows);
    } catch {
      // Resize can throw after process exits — safe to ignore
    }
  }

  kill(): void {
    this.pty.kill();
  }
}

/**
 * Ensure spawn-helper has executable permissions.
 *
 * node-pty ships prebuilt binaries, but npm/pnpm can strip the +x bit
 * during install. Without it, posix_spawnp fails at runtime.
 * This mirrors the fix used by t3code's NodePTY layer.
 */
function fixSpawnHelperPermissions(): void {
  try {
    const require = createRequire(import.meta.url);
    const nodePtyPath = dirname(require.resolve("node-pty/package.json"));
    const prebuildsDir = join(nodePtyPath, "prebuilds");

    if (!existsSync(prebuildsDir)) return;

    for (const platform of readdirSync(prebuildsDir)) {
      const helperPath = join(prebuildsDir, platform, "spawn-helper");
      if (existsSync(helperPath)) {
        chmodSync(helperPath, 0o755);
      }
    }
  } catch {
    // Best-effort — if we can't fix permissions, spawn() will give a clear error
  }
}

/**
 * Create the node-pty adapter factory.
 *
 * Must be called (and awaited) once at startup to load the native module.
 * Returns a synchronous factory function for TerminalManager to use.
 */
export async function createNodePtyFactory(): Promise<PtyAdapterFactory> {
  fixSpawnHelperPermissions();
  const pty = await loadNodePty();

  return (options: PtySpawnOptions) => {
    const shell = options.shell ?? resolveShell();
    const args = resolveShellArgs(shell);
    const env = buildEnv(options.env);
    const cwd = resolveCwd(options.cwd);

    try {
      const ptyProcess = pty.spawn(shell, args, {
        name: process.platform === "win32" ? "xterm-color" : "xterm-256color",
        cols: options.cols,
        rows: options.rows,
        cwd,
        env,
      });

      return new NodePtyProcess(ptyProcess);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to spawn terminal (shell=${shell}, cwd=${cwd}): ${msg}`);
    }
  };
}
