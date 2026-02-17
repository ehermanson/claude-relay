import { createContext, useContext, type ReactNode } from "react";
import { useWebSocket, type MessageHandler } from "../hooks/useWebSocket";
import type { InstanceInfo, ClientMessage } from "@shared/types";

interface WebSocketContextValue {
  isConnected: boolean;
  instances: InstanceInfo[];
  send: (message: ClientMessage) => void;
  subscribe: (instanceId: string) => void;
  unsubscribe: (instanceId: string) => void;
  addMessageHandler: (handler: MessageHandler) => () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const ws = useWebSocket();
  return <WebSocketContext.Provider value={ws}>{children}</WebSocketContext.Provider>;
}

export function useWS() {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error("useWS must be used within WebSocketProvider");
  return ctx;
}
