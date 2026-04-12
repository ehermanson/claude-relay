/**
 * Core configuration for Relay
 *
 * Defines the subset of config needed by the core library (process management,
 * instance orchestration) without any server-specific fields.
 */

import { cpSync, existsSync, renameSync, rmSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { defaultLogger, type Logger } from "#core/logger.js";
import type { ProviderKind } from "#core/types.js";

/**
 * Core configuration — the subset needed by ClaudeProcess and InstanceManager.
 * The server layer extends this with HTTP/auth-specific fields.
 */
export interface CoreConfig {
  /** Working directory for Claude processes */
  workingDirectory: string;
  /** Whether to pass --dangerously-skip-permissions to Claude */
  dangerouslySkipPermissions: boolean;
  /** Process timeout in milliseconds (0 = no timeout) */
  processTimeout: number;
  /** Maximum number of concurrent managed Claude processes */
  maxProcesses: number;
  /** Logger implementation */
  logger: Logger;
  /** Path to the SQLite database for session persistence */
  dbPath: string;
  /** Default model for new managed instances (e.g. "claude-opus-4-6"). Omit to use Claude's default. */
  defaultModel?: string;
  /** Provider-specific data directories (e.g. { claude: "~/.claude", codex: "~/.codex" }) */
  providerDirs: Partial<Record<ProviderKind, string>>;
}

/**
 * Options for standalone core usage (without the server layer).
 */
export type CoreOptions = Partial<CoreConfig>;

/**
 * Merge user options with defaults to produce a full core config.
 */
function resolveRelayDir(): string {
  if (process.env.RELAY_HOME) {
    return resolve(process.env.RELAY_HOME);
  }

  const home = homedir();
  const defaultDir = join(home, ".relay");
  const legacyDevDir = join(home, ".relay-dev");

  if (!existsSync(legacyDevDir)) {
    return defaultDir;
  }

  try {
    if (!existsSync(defaultDir)) {
      renameSync(legacyDevDir, defaultDir);
    } else {
      cpSync(legacyDevDir, defaultDir, { recursive: true, force: true });
      rmSync(legacyDevDir, { recursive: true, force: true });
    }
    console.warn(`[Relay] Migrated legacy dev state from ${legacyDevDir} to ${defaultDir}`);
  } catch (err) {
    console.warn(
      `[Relay] Failed to migrate legacy dev state from ${legacyDevDir} to ${defaultDir}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return defaultDir;
}

/** Base directory for Relay state: ~/.relay by default, or RELAY_HOME when explicitly set. */
export const relayDir = resolveRelayDir();

export function resolveCoreConfig(options: CoreOptions = {}): CoreConfig {
  const home = homedir();
  return {
    workingDirectory: options.workingDirectory ?? process.cwd(),
    dangerouslySkipPermissions: options.dangerouslySkipPermissions ?? true,
    processTimeout: options.processTimeout ?? 10 * 60 * 1000,
    maxProcesses: options.maxProcesses ?? 15,
    logger: options.logger ?? defaultLogger,
    dbPath: options.dbPath ?? join(relayDir, "sessions.db"),
    defaultModel: options.defaultModel,
    providerDirs: options.providerDirs ?? {
      claude: join(home, ".claude"),
      codex: join(home, ".codex"),
      gemini: join(home, ".gemini"),
    },
  };
}
