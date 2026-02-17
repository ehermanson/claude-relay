import { useReducer, useCallback, useRef, useEffect, useState } from "react";
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
      return [...state, action.instance];
    case "removed":
      return state.filter((i) => i.id !== action.instanceId);
    case "status":
      return state.map((i) => (i.id === action.instanceId ? action.instance : i));
  }
}

export type MessageHandler = (message: ServerMessage) => void;

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [instances, dispatch] = useReducer(instanceReducer, []);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());

  const send = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const subscribe = useCallback(
    (instanceId: string) => {
      send({ type: "subscribe", instanceId });
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

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage;

        // Handle instance-level messages in the reducer
        switch (message.type) {
          case "connected":
            setIsConnected(true);
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

    ws.onclose = () => {
      setIsConnected(false);
      reconnectRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return {
    isConnected,
    instances,
    send,
    subscribe,
    unsubscribe,
    addMessageHandler,
  };
}
