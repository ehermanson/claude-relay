import { useReducer, useRef, useEffect, useState, useCallback } from "react";
import type { ServerMessage, InstanceInfo, ClientMessage } from "@shared/types";

// Instance list reducer
type InstanceAction =
  | { type: "set_list"; instances: InstanceInfo[] }
  | { type: "created"; instance: InstanceInfo }
  | { type: "removed"; instanceId: string }
  | { type: "status"; instanceId: string; instance: InstanceInfo };

function instanceReducer(state: InstanceInfo[], action: InstanceAction): InstanceInfo[] {
  switch (action.type) {
    case "set_list":
      return action.instances;
    case "created":
      // Deduplicate — ignore if an instance with the same ID already exists
      if (state.some((i) => i.id === action.instance.id)) return state;
      return [...state, action.instance];
    case "removed":
      return state.filter((i) => i.id !== action.instanceId);
    case "status":
      return state.map((i) => (i.id === action.instanceId ? action.instance : i));
  }
}

export type MessageHandler = (message: ServerMessage) => void;

// Reconnect backoff: 300ms, 600ms, 1.2s, 2.4s, capped at 5s
const RECONNECT_BASE = 300;
const RECONNECT_MAX = 5_000;

// Grace period before showing disconnected state in the UI.
// Hides brief dev-mode server restarts from the user.
const DISCONNECT_GRACE = 1_500;

// Stale connection detection: if no message received within this window,
// the connection is presumed dead and we force a reconnect. The server
// sends a heartbeat message every 30s, so 45s gives comfortable margin.
const STALE_TIMEOUT = 45_000;

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [isSyncing, setIsSyncing] = useState(true);
  // connectionId increments on each successful WS connection.
  // Used by consumers (e.g. instance-view) to trigger re-subscription
  // independently of the visual isConnected state (which has a grace period).
  const [connectionId, setConnectionId] = useState(0);
  const [instances, dispatch] = useReducer(instanceReducer, []);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const backoffRef = useRef(RECONNECT_BASE);
  const graceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMessageRef = useRef(0);
  const staleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const send = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const subscribe = useCallback(
    (instanceId: string, lastSeenSequence?: number, replayEpoch?: number) => {
      send({ type: "subscribe", instanceId, lastSeenSequence, replayEpoch });
    },
    [send],
  );

  const unsubscribe = useCallback(
    (instanceId: string) => {
      send({ type: "unsubscribe", instanceId });
    },
    [send],
  );

  const addMessageHandler = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    wsRef.current = ws;

    ws.onopen = () => {
      lastMessageRef.current = Date.now();
      // Start stale-connection checker
      if (staleTimerRef.current) clearInterval(staleTimerRef.current);
      staleTimerRef.current = setInterval(() => {
        if (
          Date.now() - lastMessageRef.current > STALE_TIMEOUT &&
          ws.readyState === WebSocket.OPEN
        ) {
          console.warn("WebSocket stale (no messages), forcing reconnect");
          ws.close();
        }
      }, 10_000);
    };

    ws.onmessage = (event) => {
      lastMessageRef.current = Date.now();

      try {
        const message = JSON.parse(event.data) as ServerMessage;

        // Handle instance-level messages in the reducer
        switch (message.type) {
          case "connected":
            // Cancel grace timer — we reconnected before it fired
            if (graceRef.current) {
              clearTimeout(graceRef.current);
              graceRef.current = null;
            }
            backoffRef.current = RECONNECT_BASE;
            setIsConnected(true);
            setIsSyncing(true); // Reset on reconnect — wait for scan_complete
            setConnectionId((n) => n + 1);
            break;
          case "scan_complete":
            setIsSyncing(false);
            break;
          case "instance_list":
            dispatch({ type: "set_list", instances: message.instances });
            break;
          case "instance_created":
            dispatch({ type: "created", instance: message.instance });
            break;
          case "instance_removed":
            dispatch({ type: "removed", instanceId: message.instanceId });
            break;
          case "instance_status":
            dispatch({
              type: "status",
              instanceId: message.instanceId,
              instance: message.instance,
            });
            break;
        }

        // Forward all messages to registered handlers
        for (const handler of handlersRef.current) {
          handler(message);
        }
      } catch (e) {
        console.error("Failed to parse WS message:", e);
      }
    };

    ws.onclose = (event) => {
      if (staleTimerRef.current) clearInterval(staleTimerRef.current);

      // Server rejected us as unauthorized — redirect to login
      if (event.code === 4001) {
        window.location.href = "/login";
        return;
      }

      // Delay the visual disconnected state so brief restarts don't flash
      if (!graceRef.current) {
        graceRef.current = setTimeout(() => {
          graceRef.current = null;
          setIsConnected(false);
        }, DISCONNECT_GRACE);
      }

      // Reconnect with exponential backoff
      const delay = backoffRef.current;
      backoffRef.current = Math.min(backoffRef.current * 2, RECONNECT_MAX);
      reconnectRef.current = setTimeout(connect, delay);
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (staleTimerRef.current) clearInterval(staleTimerRef.current);
      if (graceRef.current) clearTimeout(graceRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    isConnected,
    isSyncing,
    connectionId,
    instances,
    send,
    subscribe,
    unsubscribe,
    addMessageHandler,
  };
}
