import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useWebSocket, type MessageHandler } from "../hooks/use-web-socket";
import type { InstanceInfo, ClientMessage } from "@shared/types";

// Stable methods that never change — components consuming only this won't re-render
interface WSMethodsContextValue {
  send: (message: ClientMessage) => void;
  subscribe: (instanceId: string, lastSeenSequence?: number, replayEpoch?: number) => void;
  unsubscribe: (instanceId: string) => void;
  addMessageHandler: (handler: MessageHandler) => () => void;
  reconnectNow: () => void;
}

// State that changes over time
interface WSStateContextValue {
  isConnected: boolean;
  isSyncing: boolean;
  connectionId: number;
  instances: InstanceInfo[];
}

const WSMethodsContext = createContext<WSMethodsContextValue | null>(null);
const WSStateContext = createContext<WSStateContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const {
    isConnected,
    isSyncing,
    connectionId,
    instances,
    send,
    subscribe,
    unsubscribe,
    addMessageHandler,
    reconnectNow,
  } = useWebSocket();

  const methods = useMemo(
    () => ({ send, subscribe, unsubscribe, addMessageHandler, reconnectNow }),
    [send, subscribe, unsubscribe, addMessageHandler, reconnectNow],
  );
  const state = useMemo(
    () => ({ isConnected, isSyncing, connectionId, instances }),
    [isConnected, isSyncing, connectionId, instances],
  );

  return (
    <WSMethodsContext.Provider value={methods}>
      <WSStateContext.Provider value={state}>{children}</WSStateContext.Provider>
    </WSMethodsContext.Provider>
  );
}

/** Stable methods only — never triggers re-renders */
export function useWSMethods() {
  const ctx = useContext(WSMethodsContext);
  if (!ctx) throw new Error("useWSMethods must be used within WebSocketProvider");
  return ctx;
}

/** Connection + instance state — re-renders when instances or connection changes */
export function useWSState() {
  const ctx = useContext(WSStateContext);
  if (!ctx) throw new Error("useWSState must be used within WebSocketProvider");
  return ctx;
}
