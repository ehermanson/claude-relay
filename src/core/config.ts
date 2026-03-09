/**
 * Core configuration for Claude Relay
 *
 * Defines the subset of config needed by the core library (process management,
 * instance orchestration) without any server-specific fields.
 */

import { join } from "path";
import { homedir } from "os";
import { defaultLogger, type Logger } from "./logger.js";

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
  /** Legacy manifest file path — used only for one-time migration to SQLite */
  manifestFile?: string;
  /** Override for ~/.claude directory (used in tests) */
  claudeDir?: string;
  /** Override for ~/.codex directory (used in tests and Codex transcript restore) */
  codexDir?: string;
}

/**
 * Options for standalone core usage (without the server layer).
 */
export type CoreOptions = Partial<CoreConfig>;

/**
 * Merge user options with defaults to produce a full core config.
 */
export function resolveCoreConfig(options: CoreOptions = {}): CoreConfig {
  return {
    workingDirectory: options.workingDirectory ?? process.cwd(),
    dangerouslySkipPermissions: options.dangerouslySkipPermissions ?? false,
    processTimeout: options.processTimeout ?? 5 * 60 * 1000,
    maxProcesses: options.maxProcesses ?? 15,
    logger: options.logger ?? defaultLogger,
    dbPath: options.dbPath ?? join(homedir(), ".claude-relay", "sessions.db"),
    defaultModel: options.defaultModel,
    manifestFile: options.manifestFile,
    codexDir: options.codexDir,
  };
}
