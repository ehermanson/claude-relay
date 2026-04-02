import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export interface RelaySibling {
  id: string;
  name: string;
  status: string;
}

interface MessageRelayContextValue {
  siblings: RelaySibling[];
  onSendToChat: (targetInstanceId: string, messageText: string) => void;
  onSendToNewChat: (messageText: string) => void;
}

const MessageRelayContext = createContext<MessageRelayContextValue | null>(null);

export function MessageRelayProvider({
  value,
  children,
}: {
  value: MessageRelayContextValue;
  children: ReactNode;
}) {
  return <MessageRelayContext.Provider value={value}>{children}</MessageRelayContext.Provider>;
}

export function useMessageRelay(): MessageRelayContextValue | null {
  return useContext(MessageRelayContext);
}
