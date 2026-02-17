import { useReducer, useCallback, useRef } from "react";
import type {
  ServerMessage,
  ActivityMessage,
  HistoryEntry,
} from "@shared/types";

// A rendered item in the message list
export type ChatItem =
  | { kind: "user"; text: string; timestamp?: number }
  | { kind: "claude"; text: string; timestamp?: number }
  | { kind: "system"; text: string; isError?: boolean }
  | { kind: "thinking-block"; text: string }
  | { kind: "thinking-indicator" }
  | { kind: "activity-group"; activities: ActivityMessage[] };

interface State {
  items: ChatItem[];
  isProcessing: boolean;
}

type Action =
  | { type: "reset" }
  | { type: "replay"; history: HistoryEntry[] }
  | { type: "output"; text: string; isWaiting: boolean; thinking?: string }
  | { type: "activity"; message: ActivityMessage }
  | { type: "user"; text: string }
  | { type: "exit"; code: number }
  | { type: "error"; message: string }
  | { type: "show_thinking" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return { items: [], isProcessing: false };

    case "replay": {
      // Replay history to rebuild items
      let items: ChatItem[] = [];
      let claudeText = "";
      let claudeTimestamp: number | undefined;
      let inActivityGroup = false;
      let currentActivities: ActivityMessage[] = [];

      const flushActivities = () => {
        if (currentActivities.length > 0) {
          items.push({ kind: "activity-group", activities: [...currentActivities] });
          currentActivities = [];
        }
        inActivityGroup = false;
      };

      const flushClaude = () => {
        if (claudeText) {
          items.push({ kind: "claude", text: claudeText, timestamp: claudeTimestamp });
          claudeText = "";
          claudeTimestamp = undefined;
        }
      };

      for (const entry of action.history) {
        const msg = entry.message;
        switch (msg.type) {
          case "output":
            if (msg.thinking) {
              items.push({ kind: "thinking-block", text: msg.thinking });
            } else if (msg.text && msg.text.trim()) {
              flushActivities();
              if (!claudeText) claudeTimestamp = entry.timestamp;
              claudeText += msg.text;
            }
            if (msg.isWaiting) {
              flushActivities();
              flushClaude();
            }
            break;
          case "user":
            flushActivities();
            flushClaude();
            items.push({ kind: "user", text: msg.text, timestamp: entry.timestamp });
            break;
          case "activity":
            inActivityGroup = true;
            currentActivities.push(msg);
            break;
          case "exit":
            flushActivities();
            flushClaude();
            if (msg.code !== 0) {
              items.push({
                kind: "system",
                text: `Claude process exited with code ${msg.code}`,
                isError: true,
              });
            }
            break;
        }
      }

      flushActivities();
      flushClaude();

      return { items, isProcessing: false };
    }

    case "output": {
      let items = [...state.items];

      if (action.thinking) {
        // Remove thinking indicator if present
        items = items.filter((i) => i.kind !== "thinking-indicator");
        items.push({ kind: "thinking-block", text: action.thinking });
        return { items, isProcessing: true };
      }

      if (action.text && action.text.trim()) {
        // Remove thinking indicator
        items = items.filter((i) => i.kind !== "thinking-indicator");

        // Close activity group (don't need to do anything, just stop appending)

        // Append to existing claude message or create new one
        const lastIdx = items.length - 1;
        if (lastIdx >= 0 && items[lastIdx].kind === "claude") {
          const prev = items[lastIdx] as { kind: "claude"; text: string; timestamp?: number };
          items[lastIdx] = {
            kind: "claude",
            text: prev.text + action.text,
            timestamp: prev.timestamp,
          };
        } else {
          items.push({ kind: "claude", text: action.text, timestamp: Date.now() });
        }
      }

      if (action.isWaiting) {
        items = items.filter((i) => i.kind !== "thinking-indicator");
        return { items, isProcessing: false };
      }

      return { items, isProcessing: true };
    }

    case "activity": {
      let items = [...state.items];
      // Remove thinking indicator
      items = items.filter((i) => i.kind !== "thinking-indicator");

      // Append to the current activity group or create a new one
      const lastIdx = items.length - 1;
      if (lastIdx >= 0 && items[lastIdx].kind === "activity-group") {
        const group = items[lastIdx] as {
          kind: "activity-group";
          activities: ActivityMessage[];
        };
        items[lastIdx] = {
          kind: "activity-group",
          activities: [...group.activities, action.message],
        };
      } else {
        items.push({
          kind: "activity-group",
          activities: [action.message],
        });
      }

      return { items, isProcessing: true };
    }

    case "user": {
      // Close activity group (new user message starts fresh)
      let items = [...state.items];
      items = items.filter((i) => i.kind !== "thinking-indicator");
      items.push({ kind: "user", text: action.text, timestamp: Date.now() });
      return { items, isProcessing: state.isProcessing };
    }

    case "exit": {
      let items = [...state.items];
      items = items.filter((i) => i.kind !== "thinking-indicator");
      if (action.code !== 0) {
        items.push({
          kind: "system",
          text: `Claude process exited with code ${action.code}`,
          isError: true,
        });
      }
      return { items, isProcessing: false };
    }

    case "error": {
      let items = [...state.items];
      items = items.filter((i) => i.kind !== "thinking-indicator");
      items.push({ kind: "system", text: `Error: ${action.message}`, isError: true });
      return { items, isProcessing: false };
    }

    case "show_thinking": {
      const items = [...state.items];
      if (!items.some((i) => i.kind === "thinking-indicator")) {
        items.push({ kind: "thinking-indicator" });
      }
      return { items, isProcessing: true };
    }

    default:
      return state;
  }
}

export function useInstanceMessages() {
  const [state, dispatch] = useReducer(reducer, {
    items: [],
    isProcessing: false,
  });
  const instanceIdRef = useRef<string | null>(null);

  const handleMessage = useCallback(
    (instanceId: string, message: ServerMessage) => {
      if (instanceIdRef.current !== instanceId) return;

      switch (message.type) {
        case "instance_history":
          if (message.instanceId === instanceId) {
            dispatch({ type: "replay", history: message.history });
          }
          break;
        case "output":
          if (message.instanceId === instanceId) {
            dispatch({
              type: "output",
              text: message.text,
              isWaiting: message.isWaiting,
              thinking: message.thinking,
            });
          }
          break;
        case "activity":
          if (message.instanceId === instanceId) {
            dispatch({ type: "activity", message });
          }
          break;
        case "user":
          if (message.instanceId === instanceId) {
            dispatch({ type: "user", text: message.text });
          }
          break;
        case "exit":
          if (message.instanceId === instanceId) {
            dispatch({ type: "exit", code: message.code });
          }
          break;
        case "error":
          if (
            !message.instanceId ||
            message.instanceId === instanceId
          ) {
            dispatch({ type: "error", message: message.message });
          }
          break;
      }
    },
    []
  );

  const setInstanceId = useCallback((id: string | null) => {
    instanceIdRef.current = id;
    dispatch({ type: "reset" });
  }, []);

  const showThinking = useCallback(() => {
    dispatch({ type: "show_thinking" });
  }, []);

  return {
    items: state.items,
    isProcessing: state.isProcessing,
    handleMessage,
    setInstanceId,
    showThinking,
  };
}
