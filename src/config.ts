/**
 * Configuration for Claude Relay
 *
 * Defines the full resolved config and the user-facing options type.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "./logger.js";

/**
 * Fully resolved configuration (all fields required).
 * This is what internal modules receive.
 */
export interface RelayConfig {
  /** Port to run the server on */
  port: number;
  /** Password for authentication */
  password: string;
  /** Session lifetime in milliseconds */
  sessionMaxAge: number;
  /** Whether to pass --dangerously-skip-permissions to Claude */
  dangerouslySkipPermissions: boolean;
  /** Process timeout in milliseconds (0 = no timeout) */
  processTimeout: number;
  /** Working directory for Claude processes */
  workingDirectory: string;
  /** Whether to serve the built-in web UI at / and /chat */
  serveUI: boolean;
  /** Logger implementation */
  logger: Logger;
  /** Max auth attempts per IP within the rate limit window */
  rateLimitMax: number;
  /** Rate limit window in milliseconds */
  rateLimitWindow: number;
  /** Maximum number of concurrent Claude instances */
  maxInstances: number;
  /** Path to the session persistence file */
  sessionFile: string;
}

/**
 * User-facing options. Password is required, everything else has defaults.
 */
export type RelayOptions = Partial<Omit<RelayConfig, "password">> & {
  password: string;
  /** Alias for workingDirectory */
  defaultWorkingDirectory?: string;
};

/**
 * Merge user options with defaults to produce a full config.
 */
export function resolveConfig(options: RelayOptions): RelayConfig {
  return {
    port: options.port ?? 7777,
    password: options.password,
    sessionMaxAge: options.sessionMaxAge ?? 7 * 24 * 60 * 60 * 1000,
    dangerouslySkipPermissions: options.dangerouslySkipPermissions ?? false,
    processTimeout: options.processTimeout ?? 5 * 60 * 1000,
    workingDirectory:
      options.workingDirectory ?? options.defaultWorkingDirectory ?? process.cwd(),
    serveUI: options.serveUI ?? true,
    logger: options.logger ?? console,
    rateLimitMax: options.rateLimitMax ?? 5,
    rateLimitWindow: options.rateLimitWindow ?? 60 * 1000,
    maxInstances: options.maxInstances ?? 10,
    sessionFile: options.sessionFile ?? join(homedir(), ".claude-relay", "sessions.json"),
  };
}
