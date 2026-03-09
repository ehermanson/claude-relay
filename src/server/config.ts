/**
 * Server configuration for Claude Relay
 *
 * Extends CoreConfig with HTTP/auth-specific fields.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import type { CoreConfig } from "../core/config.js";
import { defaultLogger } from "../core/logger.js";

/**
 * Fully resolved server configuration (all fields required).
 * Extends CoreConfig with server-specific fields.
 */
export interface RelayConfig extends CoreConfig {
  /** Port to run the server on */
  port: number;
  /** Password for authentication */
  password: string;
  /** Session lifetime in milliseconds */
  sessionMaxAge: number;
  /** Whether to serve the built-in web UI at / and /chat */
  serveUI: boolean;
  /** Max auth attempts per IP within the rate limit window */
  rateLimitMax: number;
  /** Rate limit window in milliseconds */
  rateLimitWindow: number;
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
    workingDirectory: options.workingDirectory ?? options.defaultWorkingDirectory ?? process.cwd(),
    serveUI: options.serveUI ?? true,
    logger: options.logger ?? defaultLogger,
    rateLimitMax: options.rateLimitMax ?? 5,
    rateLimitWindow: options.rateLimitWindow ?? 60 * 1000,
    maxProcesses: options.maxProcesses ?? 15,
    sessionFile: options.sessionFile ?? join(homedir(), ".claude-relay", "sessions.json"),
    dbPath: options.dbPath ?? join(homedir(), ".claude-relay", "sessions.db"),
    manifestFile: options.manifestFile,
    claudeDir: options.claudeDir,
    codexDir: options.codexDir,
  };
}
