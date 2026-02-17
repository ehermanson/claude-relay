/**
 * Claude Relay — Server Layer
 *
 * Full server with HTTP, WebSocket, auth, tunnel, and UI serving.
 * Re-exports everything from the core library for convenience.
 *
 * @example
 * ```ts
 * import { createRelay } from "claude-relay/server";
 *
 * const relay = createRelay({
 *   password: process.env.PASSWORD!,
 *   port: 8080,
 *   dangerouslySkipPermissions: true,
 *   workingDirectory: "/path/to/project",
 * });
 *
 * await relay.start();
 * // relay is now listening on http://localhost:8080
 *
 * // later...
 * await relay.stop();
 * ```
 */

import http from "node:http";
import type { WebSocketServer } from "ws";
import { resolveConfig, type RelayOptions, type RelayConfig } from "./config.js";
import { AuthManager } from "./auth.js";
import { InstanceManager } from "../core/instance-manager.js";
import { createWebSocketServer } from "./websocket.js";
import { createRequestHandler } from "./http.js";

export class ClaudeRelay {
  readonly config: RelayConfig;

  private server: http.Server;
  private wss: WebSocketServer;
  private auth: AuthManager;
  private instanceManager: InstanceManager;

  constructor(options: RelayOptions) {
    this.config = resolveConfig(options);
    this.auth = new AuthManager(this.config);
    this.instanceManager = new InstanceManager(this.config);

    // Use a lazy getter so the request handler can reference the WS connection count
    // even though the WSS is created after the HTTP server.
    let wsGetConnectionCount: (() => number) | null = null;

    const handler = createRequestHandler(
      this.config,
      this.auth,
      this.instanceManager,
      () => wsGetConnectionCount ? wsGetConnectionCount() : 0
    );
    this.server = http.createServer(handler);

    const wsHandle = createWebSocketServer(
      this.server,
      this.instanceManager,
      this.auth,
      this.config
    );
    this.wss = wsHandle.wss;
    wsGetConnectionCount = wsHandle.getConnectionCount;
  }

  /**
   * Start listening for connections.
   */
  start(): Promise<void> {
    this.instanceManager.restoreInstances();
    this.instanceManager.startDiscovery();
    return new Promise((resolve) => {
      this.server.listen(this.config.port, () => {
        this.config.logger.info(
          `Claude Relay listening on http://localhost:${this.config.port}`
        );
        resolve();
      });
    });
  }

  /**
   * Gracefully stop the server and kill any running Claude processes.
   */
  stop(): Promise<void> {
    this.instanceManager.stopAll();

    // Close all WebSocket connections first
    for (const client of this.wss.clients) {
      client.close(1001, "Server shutting down");
    }

    return new Promise((resolve, reject) => {
      this.wss.close(() => {
        this.server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }
}

/**
 * Create a new Claude Relay instance.
 */
export function createRelay(options: RelayOptions): ClaudeRelay {
  return new ClaudeRelay(options);
}

// Re-export everything from core for convenience
export * from "../core/index.js";

// Server-specific exports
export { AuthManager } from "./auth.js";
export type { RelayOptions, RelayConfig } from "./config.js";
export { resolveConfig } from "./config.js";
export { createRequestHandler } from "./http.js";
export { createWebSocketServer } from "./websocket.js";
export type { WebSocketServerHandle } from "./websocket.js";
export { startTunnel, stopTunnel } from "./tunnel.js";
