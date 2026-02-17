import { useReducer, useCallback, useRef } from "react";
import type {
  ServerMessage,
  ActivityMessage,
  HistoryEntry,
  TaskItem,
  FileChange,
  TeamInfo,
} from "@shared/types";

const IMAGE_ONLY_PATTERN = /^\s*(\[Image: source: [^\]]+\]\s*)+$/;

function isImageOnly(text: string): boolean {
  return IMAGE_ONLY_PATTERN.test(text);
}

// A rendered item in the message list
export type ChatItem =
  | { kind: "user"; text: string; timestamp?: number }
  | { kind: "claude"; text: string; timestamp?: number }
  | { kind: "system"; text: string; isError?: boolean }
  | { kind: "thinking-block"; text: string }
  | { kind: "thinking-indicator" }
  | { kind: "activity-group"; activities: ActivityMessage[] }
  | { kind: "agent-transcript"; title: string; result: string; timestamp?: number };

interface State {
  items: ChatItem[];
  isProcessing: boolean;
  currentTasks: TaskItem[] | null;
  currentFiles: FileChange[] | null;
  currentTeam: TeamInfo | null;
}

type Action =
  | { type: "reset" }
  | { type: "replay"; history: HistoryEntry[] }
  | { type: "output"; text: string; isWaiting: boolean; thinking?: string }
  | { type: "activity"; message: ActivityMessage }
  | { type: "user"; text: string }
  | { type: "transcript"; title: string; result: string }
  | { type: "exit"; code: number; signal?: string; stderr?: string }
  | { type: "error"; message: string }
  | { type: "show_thinking" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return {
        items: [],
        isProcessing: false,
        currentTasks: null,
        currentFiles: null,
        currentTeam: null,
      };

    case "replay": {
      // Replay history to rebuild items
      let items: ChatItem[] = [];
      let claudeText = "";
      let claudeTimestamp: number | undefined;
      let currentActivities: ActivityMessage[] = [];
      let currentTasks: TaskItem[] | null = null;
      let currentFiles: FileChange[] | null = null;
      let currentTeam: TeamInfo | null = null;

      const flushActivities = () => {
        if (currentActivities.length > 0) {
          items.push({ kind: "activity-group", activities: [...currentActivities] });
          currentActivities = [];
        }
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
          case "user": {
            flushActivities();
            flushClaude();
            const lastItem = items[items.length - 1];
            if (
              isImageOnly(msg.text) &&
              lastItem?.kind === "user" &&
              lastItem.timestamp &&
              entry.timestamp &&
              Math.abs(entry.timestamp - lastItem.timestamp) < 60_000
            ) {
              items[items.length - 1] = {
                ...lastItem,
                text: lastItem.text + "\n" + msg.text,
              };
            } else {
              items.push({ kind: "user", text: msg.text, timestamp: entry.timestamp });
            }
            break;
          }
          case "activity":
            if (msg.activity === "task_list" && msg.tasks) {
              currentTasks = msg.tasks;
            } else if (msg.activity === "file_list" && msg.files) {
              currentFiles = msg.files;
            } else if (msg.activity === "team_info" && msg.team) {
              currentTeam = msg.team;
            } else {
              currentActivities.push(msg);
            }
            break;
          case "transcript":
            flushActivities();
            flushClaude();
            items.push({
              kind: "agent-transcript",
              title: msg.title,
              result: msg.result,
              timestamp: entry.timestamp,
            });
            break;
          case "exit":
            flushActivities();
            flushClaude();
            if (msg.code !== 0) {
              let text = msg.signal
                ? `Claude process killed by ${msg.signal}`
                : `Claude process exited with code ${msg.code}`;
              if (msg.stderr) text += `\n${msg.stderr}`;
              items.push({ kind: "system", text, isError: true });
            }
            break;
        }
      }

      flushActivities();
      flushClaude();

      return { items, isProcessing: false, currentTasks, currentFiles, currentTeam };
    }

    case "output": {
      let items = [...state.items];

      if (action.thinking) {
        // Remove thinking indicator if present
        items = items.filter((i) => i.kind !== "thinking-indicator");
        items.push({ kind: "thinking-block", text: action.thinking });
        // Re-add indicator — more events are coming after thinking
        items.push({ kind: "thinking-indicator" });
        return { ...state, items, isProcessing: true };
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
        return { ...state, items, isProcessing: false };
      }

      return { ...state, items, isProcessing: true };
    }

    case "activity": {
      let items = [...state.items];
      // Remove thinking indicator
      items = items.filter((i) => i.kind !== "thinking-indicator");

      if (action.message.activity === "task_list" && action.message.tasks) {
        // Update currentTasks — tasks live in the sidecar, not in the chat
        const currentTasks = action.message.tasks;

        // Re-add thinking indicator — Claude is still processing
        items.push({ kind: "thinking-indicator" });

        return { ...state, items, isProcessing: true, currentTasks };
      } else if (action.message.activity === "file_list" && action.message.files) {
        // Update currentFiles — files live in the sidecar, not in the chat
        const currentFiles = action.message.files;

        // Re-add thinking indicator — Claude is still processing
        items.push({ kind: "thinking-indicator" });

        return { ...state, items, isProcessing: true, currentFiles };
      } else if (action.message.activity === "team_info" && action.message.team) {
        // Update currentTeam — team info lives in the sidecar, not in the chat
        const currentTeam = action.message.team;

        // Re-add thinking indicator — Claude is still processing
        items.push({ kind: "thinking-indicator" });

        return { ...state, items, isProcessing: true, currentTeam };
      } else {
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
      }

      // Re-add thinking indicator — Claude is still processing after each activity
      items.push({ kind: "thinking-indicator" });

      return { ...state, items, isProcessing: true };
    }

    case "transcript": {
      let items = [...state.items];
      items = items.filter((i) => i.kind !== "thinking-indicator");
      items.push({
        kind: "agent-transcript",
        title: action.title,
        result: action.result,
        timestamp: Date.now(),
      });
      return { ...state, items };
    }

    case "user": {
      // Close activity group (new user message starts fresh)
      let items = [...state.items];
      items = items.filter((i) => i.kind !== "thinking-indicator");
      const now = Date.now();
      const lastItem = items[items.length - 1];
      if (
        isImageOnly(action.text) &&
        lastItem?.kind === "user" &&
        lastItem.timestamp &&
        now - lastItem.timestamp < 60_000
      ) {
        items[items.length - 1] = {
          ...lastItem,
          text: lastItem.text + "\n" + action.text,
        };
        return { ...state, items };
      }
      items.push({ kind: "user", text: action.text, timestamp: now });
      return { ...state, items };
    }

    case "exit": {
      let items = [...state.items];
      items = items.filter((i) => i.kind !== "thinking-indicator");
      if (action.code !== 0) {
        let text = action.signal
          ? `Claude process killed by ${action.signal}`
          : `Claude process exited with code ${action.code}`;
        if (action.stderr) text += `\n${action.stderr}`;
        items.push({ kind: "system", text, isError: true });
      }
      return { ...state, items, isProcessing: false };
    }

    case "error": {
      let items = [...state.items];
      items = items.filter((i) => i.kind !== "thinking-indicator");
      items.push({ kind: "system", text: `Error: ${action.message}`, isError: true });
      return { ...state, items, isProcessing: false };
    }

    case "show_thinking": {
      const items = [...state.items];
      if (!items.some((i) => i.kind === "thinking-indicator")) {
        items.push({ kind: "thinking-indicator" });
      }
      return { ...state, items, isProcessing: true };
    }

    default:
      return state;
  }
}

export function useInstanceMessages() {
  const [state, dispatch] = useReducer(reducer, {
    items: [],
    isProcessing: false,
    currentTasks: null,
    currentFiles: null,
    currentTeam: null,
  });
  const instanceIdRef = useRef<string | null>(null);

  const handleMessage = useCallback((instanceId: string, message: ServerMessage) => {
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
      case "transcript":
        if (message.instanceId === instanceId) {
          dispatch({
            type: "transcript",
            title: message.title,
            result: message.result,
          });
        }
        break;
      case "exit":
        if (message.instanceId === instanceId) {
          dispatch({
            type: "exit",
            code: message.code,
            signal: message.signal,
            stderr: message.stderr,
          });
        }
        break;
      case "error":
        if (!message.instanceId || message.instanceId === instanceId) {
          dispatch({ type: "error", message: message.message });
        }
        break;
    }
  }, []);

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
    currentTasks: state.currentTasks,
    currentFiles: state.currentFiles,
    currentTeam: state.currentTeam,
    handleMessage,
    setInstanceId,
    showThinking,
  };
}
