import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export interface RelaySibling {
  id: string;
  name: string;
  status: string;
}

export interface SpinOffRequest {
  anchorIndex?: number;
  selectedText?: string;
}

interface MessageRelayContextValue {
  siblings: RelaySibling[];
  onSendToChat: (targetInstanceId: string, messageText: string) => void;
  onSendToNewChat: (messageText: string) => void;
  /** Trigger a spin-off from this chat, optionally anchored to a message or excerpt */
  onSpinOff: (request?: SpinOffRequest) => void;
  /** Current instance ID for this chat */
  instanceId: string;
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
