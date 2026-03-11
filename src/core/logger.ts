/**
 * Logger interface for Relay
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

/**
 * Default logger — prints info/warn/error, suppresses debug.
 * Set DEBUG=1 to enable debug output.
 */
export const defaultLogger: Logger = {
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: process.env.DEBUG ? console.debug.bind(console) : () => {},
};

/** A logger that discards all output. */
export const noopLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};
