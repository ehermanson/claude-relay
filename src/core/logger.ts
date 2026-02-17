/**
 * Logger interface for Claude Relay
 *
 * Consumers can provide any object that implements these methods.
 * Defaults to console when not specified.
 */

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

/** A logger that discards all output. */
export const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};
