import { useCallback, useReducer, useRef } from "react";
import type {
  ServerMessage,
  ActivityMessage,
  HistoryEntry,
  TaskItem,
  FileChange,
  TeamInfo,
  AgentActivity,
} from "@shared/types";

const IMAGE_ONLY_PATTERN = /^\s*(\[Image: source: [^\]]+\]\s*)+$/;

function isImageOnly(text: string): boolean {
  return IMAGE_ONLY_PATTERN.test(text);
}

// A rendered item in the message list
export type ChatItem =
  | { kind: "user"; text: string; timestamp?: number }
  | { kind: "assistant"; text: string; timestamp?: number }
  | { kind: "system"; text: string; isError?: boolean }
  | { kind: "thinking-block"; text: string }
  | { kind: "activity-group"; activities: ActivityMessage[] }
  | { kind: "agent-transcript"; title: string; result: string; timestamp?: number };

export interface LiveActivity {
  /** Human-readable description of what's happening */
  description: string;
  /** Tool name if applicable */
  tool?: string;
  /** When this specific activity started */
  startedAt: number;
}

interface State {
  items: ChatItem[];
  hasLoadedHistory: boolean;
  isProcessing: boolean;
  showThinkingIndicator: boolean;
  currentTasks: TaskItem[] | null;
  currentFiles: FileChange[] | null;
  currentTeam: TeamInfo | null;
  currentAgentActivities: AgentActivity[] | null;
  /** Most recent activity for the live status strip */
  lastActivity: LiveActivity | null;
  /** When the current processing turn started (user sent a message) */
  processingStartedAt: number | null;
}

type Action =
  | { type: "reset" }
  | { type: "restore"; cached: State }
  | { type: "replay"; history: HistoryEntry[] }
  | { type: "output"; text: string; isWaiting: boolean; thinking?: string }
  | { type: "activity"; message: ActivityMessage }
  | { type: "user"; text: string }
  | { type: "transcript"; title: string; result: string }
  | { type: "exit"; code: number; signal?: string; stderr?: string }
  | { type: "error"; message: string }
  | { type: "show_thinking" };

// Module-level cache — persists across mounts/unmounts within a page session.
// Switching between sessions restores cached state instantly instead of showing
// a loading spinner while the WS history replay arrives.
const stateCache = new Map<string, State>();

const EMPTY_STATE: State = {
  items: [],
  hasLoadedHistory: false,
  isProcessing: false,
  showThinkingIndicator: false,
  currentTasks: null,
  currentFiles: null,
  currentTeam: null,
  currentAgentActivities: null,
  lastActivity: null,
  processingStartedAt: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return EMPTY_STATE;

    case "restore":
      return action.cached;

    case "replay": {
      // Replay history to rebuild items
      let items: ChatItem[] = [];
      let assistantText = "";
      let assistantTimestamp: number | undefined;
      let currentActivities: ActivityMessage[] = [];
      let currentTasks: TaskItem[] | null = null;
      let currentFiles: FileChange[] | null = null;
      let currentTeam: TeamInfo | null = null;
      let currentAgentActivities: AgentActivity[] | null = null;

      const flushActivities = () => {
        if (currentActivities.length > 0) {
          items.push({ kind: "activity-group", activities: [...currentActivities] });
          currentActivities = [];
        }
      };

      const flushAssistant = () => {
        if (assistantText) {
          items.push({ kind: "assistant", text: assistantText, timestamp: assistantTimestamp });
          assistantText = "";
          assistantTimestamp = undefined;
        }
      };

      for (const entry of action.history) {
        const msg = entry.message;
        switch (msg.type) {
          case "output":
            if (msg.thinking) {
              items.push({ kind: "thinking-block", text: msg.thinking });
            } else if (msg.text && msg.text.trim()) {
              // Dedup: skip if text is already at the end of accumulated assistant text
              if (!assistantText.endsWith(msg.text)) {
                flushActivities();
                if (!assistantText) assistantTimestamp = entry.timestamp;
                assistantText += msg.text;
              }
            }
            if (msg.isWaiting) {
              flushActivities();
              flushAssistant();
            }
            break;
          case "user": {
            flushActivities();
            flushAssistant();
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
            } else if (msg.activity === "agent_activity" && msg.agentActivities) {
              currentAgentActivities = msg.agentActivities;
            } else {
              flushAssistant();
              currentActivities.push(msg);
            }
            break;
          case "transcript":
            flushActivities();
            flushAssistant();
            items.push({
              kind: "agent-transcript",
              title: msg.title,
              result: msg.result,
              timestamp: entry.timestamp,
            });
            break;
          case "exit":
            flushActivities();
            flushAssistant();
            if (msg.code !== 0) {
              let text = msg.signal
                ? `Session process killed by ${msg.signal}`
                : `Session process exited with code ${msg.code}`;
              if (msg.stderr) text += `\n${msg.stderr}`;
              items.push({ kind: "system", text, isError: true });
            }
            break;
        }
      }

      flushActivities();
      flushAssistant();

      return {
        items,
        hasLoadedHistory: true,
        isProcessing: false,
        showThinkingIndicator: false,
        currentTasks,
        currentFiles,
        currentTeam,
        currentAgentActivities,
        lastActivity: null,
        processingStartedAt: null,
      };
    }

    case "output": {
      if (action.thinking) {
        const items = [...state.items];
        items.push({ kind: "thinking-block", text: action.thinking });
        return {
          ...state,
          items,
          isProcessing: true,
          showThinkingIndicator: true,
          lastActivity: {
            description: "Thinking...",
            startedAt:
              state.lastActivity?.description === "Thinking..."
                ? state.lastActivity.startedAt
                : Date.now(),
          },
        };
      }

      if (action.text && action.text.trim()) {
        const items = [...state.items];

        // Append to existing assistant message or create new one
        const lastIdx = items.length - 1;
        if (lastIdx >= 0 && items[lastIdx].kind === "assistant") {
          const prev = items[lastIdx] as { kind: "assistant"; text: string; timestamp?: number };
          // Dedup: skip if the incoming text is already at the end of the current message
          // (can happen when JSONL watcher re-emits content after the live stream)
          if (prev.text.endsWith(action.text)) {
            if (action.isWaiting) {
              return {
                ...state,
                items,
                isProcessing: false,
                showThinkingIndicator: false,
                lastActivity: null,
                processingStartedAt: null,
              };
            }
            return state;
          }
          items[lastIdx] = {
            kind: "assistant",
            text: prev.text + action.text,
            timestamp: prev.timestamp,
          };
        } else {
          items.push({ kind: "assistant", text: action.text, timestamp: Date.now() });
        }

        if (action.isWaiting) {
          return {
            ...state,
            items,
            isProcessing: false,
            showThinkingIndicator: false,
            lastActivity: null,
            processingStartedAt: null,
          };
        }

        return {
          ...state,
          items,
          isProcessing: true,
          showThinkingIndicator: false,
          lastActivity: { description: "Responding...", startedAt: Date.now() },
        };
      }

      if (action.isWaiting) {
        return {
          ...state,
          isProcessing: false,
          showThinkingIndicator: false,
          lastActivity: null,
          processingStartedAt: null,
        };
      }

      return { ...state, isProcessing: true };
    }

    case "activity": {
      const now = Date.now();
      if (action.message.activity === "task_list" && action.message.tasks) {
        return {
          ...state,
          isProcessing: true,
          showThinkingIndicator: true,
          currentTasks: action.message.tasks,
          lastActivity: { description: "Updating tasks...", startedAt: now },
        };
      } else if (action.message.activity === "file_list" && action.message.files) {
        return {
          ...state,
          isProcessing: true,
          showThinkingIndicator: true,
          currentFiles: action.message.files,
          lastActivity: { description: "Writing files...", startedAt: now },
        };
      } else if (action.message.activity === "team_info" && action.message.team) {
        return {
          ...state,
          isProcessing: true,
          showThinkingIndicator: true,
          currentTeam: action.message.team,
          lastActivity: { description: "Managing team...", startedAt: now },
        };
      } else if (action.message.activity === "agent_activity" && action.message.agentActivities) {
        // Pick the most recently updated agent for the status strip
        const sorted = [...action.message.agentActivities].sort(
          (a, b) => b.updatedAt - a.updatedAt,
        );
        const latest = sorted[0];
        const agentDesc = latest?.description || latest?.tool || "Working...";
        return {
          ...state,
          currentAgentActivities: action.message.agentActivities,
          lastActivity: {
            description: agentDesc,
            tool: latest?.tool,
            startedAt:
              state.lastActivity?.tool === latest?.tool ? state.lastActivity.startedAt : now,
          },
        };
      } else {
        const items = [...state.items];

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

        // Build a contextual description from the activity
        const desc = action.message.description || action.message.tool || "Working...";
        return {
          ...state,
          items,
          isProcessing: true,
          showThinkingIndicator: true,
          lastActivity: { description: desc, tool: action.message.tool, startedAt: now },
        };
      }
    }

    case "transcript": {
      const items = [...state.items];
      items.push({
        kind: "agent-transcript",
        title: action.title,
        result: action.result,
        timestamp: Date.now(),
      });
      return { ...state, items, showThinkingIndicator: false };
    }

    case "user": {
      const items = [...state.items];
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
        return { ...state, items, showThinkingIndicator: false };
      }
      items.push({ kind: "user", text: action.text, timestamp: now });
      return { ...state, items, showThinkingIndicator: false, processingStartedAt: now };
    }

    case "exit": {
      if (action.code !== 0) {
        const items = [...state.items];
        let text = action.signal
          ? `Session process killed by ${action.signal}`
          : `Session process exited with code ${action.code}`;
        if (action.stderr) text += `\n${action.stderr}`;
        items.push({ kind: "system", text, isError: true });
        return {
          ...state,
          items,
          isProcessing: false,
          showThinkingIndicator: false,
          lastActivity: null,
          processingStartedAt: null,
        };
      }
      return {
        ...state,
        isProcessing: false,
        showThinkingIndicator: false,
        lastActivity: null,
        processingStartedAt: null,
      };
    }

    case "error": {
      const items = [...state.items];
      items.push({ kind: "system", text: `Error: ${action.message}`, isError: true });
      return {
        ...state,
        items,
        isProcessing: false,
        showThinkingIndicator: false,
        lastActivity: null,
        processingStartedAt: null,
      };
    }

    case "show_thinking": {
      const now = Date.now();
      return {
        ...state,
        isProcessing: true,
        showThinkingIndicator: true,
        processingStartedAt: state.processingStartedAt ?? now,
        lastActivity: state.lastActivity ?? { description: "Starting...", startedAt: now },
      };
    }

    default:
      return state;
  }
}

export function useInstanceMessages() {
  const [state, dispatch] = useReducer(reducer, EMPTY_STATE);
  const instanceIdRef = useRef<string | null>(null);
  // Ref tracks latest state so cache saves in setInstanceId aren't stale
  const stateRef = useRef(state);
  stateRef.current = state;

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
    // Save outgoing instance's state to cache
    const prevId = instanceIdRef.current;
    if (prevId && stateRef.current.hasLoadedHistory) {
      stateCache.set(prevId, stateRef.current);
    }

    instanceIdRef.current = id;

    // Restore from cache if available (instant), otherwise reset.
    // The WS history replay still arrives and silently updates to the latest.
    if (id) {
      const cached = stateCache.get(id);
      if (cached) {
        dispatch({ type: "restore", cached });
        return;
      }
    }
    dispatch({ type: "reset" });
  }, []);

  const showThinking = useCallback(() => {
    dispatch({ type: "show_thinking" });
  }, []);

  return {
    items: state.items,
    hasLoadedHistory: state.hasLoadedHistory,
    isProcessing: state.isProcessing,
    showThinkingIndicator: state.showThinkingIndicator,
    currentTasks: state.currentTasks,
    currentFiles: state.currentFiles,
    currentTeam: state.currentTeam,
    currentAgentActivities: state.currentAgentActivities,
    lastActivity: state.lastActivity,
    processingStartedAt: state.processingStartedAt,
    handleMessage,
    setInstanceId,
    showThinking,
  };
}
