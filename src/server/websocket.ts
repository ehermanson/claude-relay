/**
 * WebSocket Server for Claude Relay
 *
 * Handles WebSocket connections from remote clients,
 * authenticates them using session cookies, and relays messages
 * between clients and the InstanceManager.
 *
 * Each client tracks which instances it is subscribed to.
 * Output/activity/exit events go only to subscribed clients.
 * Status/create/remove events broadcast to all connected clients.
 */

import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { AuthManager } from "./auth.js";
import type { InstanceManager } from "../core/instance-manager.js";
import type { InstanceInfo } from "../core/types.js";
import type { RelayConfig } from "./config.js";
import type {
  ClientMessage,
  ServerMessage,
  OutputMessage,
  ExitMessage,
  ActivityMessage,
} from "../core/types.js";

function truncateSessionId(sessionId: string): string {
  return sessionId.substring(0, 8) + "...";
}

function sendMessage(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/** Result returned by createWebSocketServer */
export interface WebSocketServerHandle {
  wss: WebSocketServer;
  /** Returns the number of currently authenticated WebSocket connections */
  getConnectionCount(): number;
}

/**
 * Create and configure the WebSocket server.
 */
export function createWebSocketServer(
  server: http.Server,
  instanceManager: InstanceManager,
  auth: AuthManager,
  config: RelayConfig
): WebSocketServerHandle {
  const wss = new WebSocketServer({ server });
  const log = config.logger;

  // Per-client subscription sets
  const subscriptions = new Map<WebSocket, Set<string>>();

  // Broadcast to all authenticated clients
  function broadcast(message: ServerMessage): void {
    for (const [ws] of subscriptions) {
      sendMessage(ws, message);
    }
  }

  // Send to clients subscribed to a specific instance
  function sendToSubscribers(instanceId: string, message: ServerMessage): void {
    for (const [ws, subs] of subscriptions) {
      if (subs.has(instanceId)) {
        sendMessage(ws, message);
      }
    }
  }

  // Wire up InstanceManager events
  instanceManager.on("instance:output", (instanceId: string, message: OutputMessage) => {
    sendToSubscribers(instanceId, { ...message, instanceId });
  });

  instanceManager.on("instance:activity", (instanceId: string, message: ActivityMessage) => {
    sendToSubscribers(instanceId, { ...message, instanceId });
  });

  instanceManager.on("instance:exit", (instanceId: string, message: ExitMessage) => {
    sendToSubscribers(instanceId, { ...message, instanceId });
  });

  instanceManager.on("instance:status", (instanceId: string, info: InstanceInfo) => {
    broadcast({ type: "instance_status", instanceId, instance: info });
  });

  // External session discovery events
  instanceManager.on("instance:created", (instanceId: string, info: InstanceInfo) => {
    broadcast({ type: "instance_created", instance: info });
  });

  instanceManager.on("instance:removed", (instanceId: string) => {
    // Remove from all clients' subscriptions
    for (const [, subs] of subscriptions) {
      subs.delete(instanceId);
    }
    broadcast({ type: "instance_removed", instanceId });
  });

  instanceManager.on("instance:user", (instanceId: string, message) => {
    sendToSubscribers(instanceId, { ...message, instanceId });
  });

  wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
    const cookieHeader = req.headers.cookie;
    const session = auth.getSessionFromCookies(cookieHeader);

    if (!session) {
      log.info("WebSocket connection rejected: Unauthorized");
      ws.close(4001, "Unauthorized");
      return;
    }

    const truncatedId = truncateSessionId(session.id);
    log.info(`WebSocket connected: session ${truncatedId}`);

    // Initialize subscription tracking
    subscriptions.set(ws, new Set());

    // Send connected + current instance list
    sendMessage(ws, { type: "connected" });
    sendMessage(ws, {
      type: "instance_list",
      instances: instanceManager.listInstances(),
    });

    ws.on("message", (data: Buffer | string) => {
      try {
        const rawMessage = typeof data === "string" ? data : data.toString();
        const message = JSON.parse(rawMessage) as ClientMessage;

        switch (message.type) {
          case "list_instances":
            sendMessage(ws, {
              type: "instance_list",
              instances: instanceManager.listInstances(),
            });
            break;

          case "create_instance": {
            try {
              const info = instanceManager.createInstance({
                name: message.name,
                workingDirectory: message.workingDirectory,
                dangerouslySkipPermissions: message.dangerouslySkipPermissions,
              });
              broadcast({ type: "instance_created", instance: info });
            } catch (err) {
              sendMessage(ws, {
                type: "error",
                message: err instanceof Error ? err.message : "Failed to create instance",
              });
            }
            break;
          }

          case "remove_instance": {
            const removed = instanceManager.removeInstance(message.instanceId);
            if (removed) {
              // Remove from all clients' subscriptions
              for (const [, subs] of subscriptions) {
                subs.delete(message.instanceId);
              }
              broadcast({ type: "instance_removed", instanceId: message.instanceId });
            } else {
              sendMessage(ws, {
                type: "error",
                message: `Instance ${message.instanceId} not found`,
              });
            }
            break;
          }

          case "subscribe": {
            const subs = subscriptions.get(ws);
            if (subs) {
              subs.add(message.instanceId);
            }
            // Send history so client catches up
            try {
              const history = instanceManager.getHistory(message.instanceId);
              sendMessage(ws, {
                type: "instance_history",
                instanceId: message.instanceId,
                history,
              });
            } catch {
              sendMessage(ws, {
                type: "error",
                message: `Instance ${message.instanceId} not found`,
              });
            }
            break;
          }

          case "unsubscribe": {
            const unsubs = subscriptions.get(ws);
            if (unsubs) {
              unsubs.delete(message.instanceId);
            }
            break;
          }

          case "instance_message": {
            if (typeof message.text === "string" && message.text.trim()) {
              try {
                // Echo user message to subscribers
                sendToSubscribers(message.instanceId, {
                  type: "user",
                  text: message.text,
                  instanceId: message.instanceId,
                });
                instanceManager.sendMessage(message.instanceId, message.text);
              } catch (err) {
                sendMessage(ws, {
                  type: "error",
                  message: err instanceof Error ? err.message : "Failed to send message",
                  instanceId: message.instanceId,
                });
              }
            }
            break;
          }

          case "instance_cancel": {
            try {
              instanceManager.cancelMessage(message.instanceId);
            } catch (err) {
              sendMessage(ws, {
                type: "error",
                message: err instanceof Error ? err.message : "Failed to cancel",
                instanceId: message.instanceId,
              });
            }
            break;
          }

          case "resume_instance": {
            try {
              const info = instanceManager.resumeInstance(message.instanceId);
              broadcast({ type: "instance_status", instanceId: info.id, instance: info });
            } catch (err) {
              sendMessage(ws, {
                type: "error",
                message: err instanceof Error ? err.message : "Failed to resume",
                instanceId: message.instanceId,
              });
            }
            break;
          }

          case "approve_tool": {
            try {
              const retryText = `I've granted permission for ${message.tool}. Please retry your last action.`;
              sendToSubscribers(message.instanceId, {
                type: "user",
                text: retryText,
                instanceId: message.instanceId,
              });
              instanceManager.approveToolUse(message.instanceId, message.tool);
            } catch (err) {
              sendMessage(ws, {
                type: "error",
                message: err instanceof Error ? err.message : "Failed to approve tool",
                instanceId: message.instanceId,
              });
            }
            break;
          }

          // Legacy single-instance messages (kept for compatibility)
          case "message":
            log.warn("Legacy 'message' type received — use instance_message instead");
            break;

          case "cancel":
            log.warn("Legacy 'cancel' type received — use instance_cancel instead");
            break;

          default:
            log.warn("Unknown message type:", (message as { type: string }).type);
        }
      } catch (error) {
        log.error("Failed to parse WebSocket message:", error);
      }
    });

    ws.on("error", (error) => {
      log.error(`WebSocket error for session ${truncatedId}:`, error);
    });

    ws.on("close", () => {
      log.info(`WebSocket disconnected: session ${truncatedId}`);
      subscriptions.delete(ws);
    });
  });

  return {
    wss,
    getConnectionCount(): number {
      return subscriptions.size;
    },
  };
}
