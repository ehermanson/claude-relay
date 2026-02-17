/**
 * Core configuration for Claude Relay
 *
 * Defines the subset of config needed by the core library (process management,
 * instance orchestration) without any server-specific fields.
 */

import { join } from "path";
import { homedir } from "os";
import type { Logger } from "./logger.js";

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
  /** Maximum number of concurrent Claude instances */
  maxInstances: number;
  /** Logger implementation */
  logger: Logger;
  /** Path to the instance manifest file for persistence across restarts */
  manifestFile: string;
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
    maxInstances: options.maxInstances ?? 10,
    logger: options.logger ?? console,
    manifestFile: options.manifestFile ?? join(homedir(), ".claude-relay", "instances.json"),
  };
}
