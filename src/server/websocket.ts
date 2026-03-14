/**
 * WebSocket Server for Relay
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
  TranscriptMessage,
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
  config: RelayConfig,
): WebSocketServerHandle {
  const wss = new WebSocketServer({ server });
  const log = config.logger;

  // Per-client subscription sets
  const subscriptions = new Map<WebSocket, Set<string>>();

  // Ping/pong heartbeat to detect dead connections (e.g. network drops)
  const PING_INTERVAL = 30_000;
  const alive = new Map<WebSocket, boolean>();
  const pingTimer = setInterval(() => {
    for (const [ws] of subscriptions) {
      if (alive.get(ws) === false) {
        // No pong received since last ping — connection is dead
        log.info("WebSocket connection dead (no pong), terminating");
        alive.delete(ws);
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, PING_INTERVAL);
  wss.on("close", () => clearInterval(pingTimer));

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

  instanceManager.on("instance:transcript", (instanceId: string, message: TranscriptMessage) => {
    sendToSubscribers(instanceId, { ...message, instanceId });
  });

  instanceManager.on("scan:complete", () => {
    broadcast({ type: "scan_complete" });
  });

  instanceManager.on("directory:visibility", () => {
    broadcast({ type: "instance_list", instances: instanceManager.listInstances() });
    broadcast({ type: "hidden_directories", directories: instanceManager.getHiddenDirectories() });
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
    log.debug(`WebSocket connected: session ${truncatedId}`);

    // Initialize subscription tracking and heartbeat
    subscriptions.set(ws, new Set());
    alive.set(ws, true);
    ws.on("pong", () => {
      alive.set(ws, true);
    });

    // Send connected + current instance list
    sendMessage(ws, { type: "connected" });
    sendMessage(ws, {
      type: "instance_list",
      instances: instanceManager.listInstances(),
    });
    sendMessage(ws, {
      type: "hidden_directories",
      directories: instanceManager.getHiddenDirectories(),
    });
    if (instanceManager.scanComplete) {
      sendMessage(ws, { type: "scan_complete" });
    }

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
                provider: message.provider,
                name: message.name,
                workingDirectory: message.workingDirectory,
                dangerouslySkipPermissions: message.dangerouslySkipPermissions ?? false,
                resumeSessionId: message.resumeSessionId,
                model: message.model,
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
            const hasText = typeof message.text === "string" && message.text.trim();
            const hasImages = Array.isArray(message.images) && message.images.length > 0;
            if (hasText || hasImages) {
              try {
                // sendMessage emits instance:user which is forwarded to
                // subscribers — no separate echo needed (avoids duplicates
                // when the JSONL watcher also picks up the same message).
                const resumed = instanceManager.sendMessage(
                  message.instanceId,
                  message.text || "",
                  hasImages ? message.images : undefined,
                );
                // If sendMessage triggered a transparent resume, broadcast the transition
                if (resumed) {
                  broadcast({ type: "instance_status", instanceId: resumed.id, instance: resumed });
                }
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

          case "respond_to_request": {
            try {
              instanceManager.respondToRequest(
                message.instanceId,
                message.requestId,
                message.decision,
              );
            } catch (err) {
              sendMessage(ws, {
                type: "error",
                message: err instanceof Error ? err.message : "Failed to resolve request",
                instanceId: message.instanceId,
              });
            }
            break;
          }

          case "rename_instance": {
            instanceManager.renameInstance(message.instanceId, message.name);
            break;
          }

          case "set_model": {
            instanceManager.setModel(message.instanceId, message.model);
            break;
          }

          case "set_reasoning_budget": {
            instanceManager.setReasoningBudget(message.instanceId, message.budget);
            break;
          }

          case "set_permissions": {
            instanceManager.setPermissions(message.instanceId, message.skipPermissions);
            break;
          }

          case "set_plan_mode": {
            instanceManager.setPlanMode(message.instanceId, message.planMode);
            break;
          }

          case "set_provider": {
            instanceManager.setProvider(message.instanceId, message.provider);
            break;
          }

          case "hide_directory": {
            instanceManager.hideDirectory(message.path);
            break;
          }

          case "unhide_directory": {
            instanceManager.unhideDirectory(message.path);
            break;
          }

          case "merge_instance": {
            try {
              const { targetBranch } = instanceManager.mergeInstance(message.instanceId);
              // Clean up subscriptions (instance is removed)
              for (const [, subs] of subscriptions) {
                subs.delete(message.instanceId);
              }
              broadcast({ type: "instance_removed", instanceId: message.instanceId });
              sendMessage(ws, {
                type: "notification",
                message: `Merged into ${targetBranch} successfully`,
                instanceId: message.instanceId,
              });
            } catch (err) {
              sendMessage(ws, {
                type: "error",
                message: err instanceof Error ? err.message : "Failed to merge",
                instanceId: message.instanceId,
              });
            }
            break;
          }

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
      log.debug(`WebSocket disconnected: session ${truncatedId}`);
      subscriptions.delete(ws);
      alive.delete(ws);
    });
  });

  return {
    wss,
    getConnectionCount(): number {
      return subscriptions.size;
    },
  };
}
