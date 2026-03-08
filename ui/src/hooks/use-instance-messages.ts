import { useReducer, useRef } from "react";
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
  | { kind: "claude"; text: string; timestamp?: number }
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
        showThinkingIndicator: false,
        currentTasks: null,
        currentFiles: null,
        currentTeam: null,
        currentAgentActivities: null,
        lastActivity: null,
        processingStartedAt: null,
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
      let currentAgentActivities: AgentActivity[] | null = null;

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
              // Dedup: skip if text is already at the end of accumulated claude text
              if (!claudeText.endsWith(msg.text)) {
                flushActivities();
                if (!claudeText) claudeTimestamp = entry.timestamp;
                claudeText += msg.text;
              }
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
            } else if (msg.activity === "agent_activity" && msg.agentActivities) {
              currentAgentActivities = msg.agentActivities;
            } else {
              flushClaude();
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

      return {
        items,
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

        // Append to existing claude message or create new one
        const lastIdx = items.length - 1;
        if (lastIdx >= 0 && items[lastIdx].kind === "claude") {
          const prev = items[lastIdx] as { kind: "claude"; text: string; timestamp?: number };
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
            kind: "claude",
            text: prev.text + action.text,
            timestamp: prev.timestamp,
          };
        } else {
          items.push({ kind: "claude", text: action.text, timestamp: Date.now() });
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
          ? `Claude process killed by ${action.signal}`
          : `Claude process exited with code ${action.code}`;
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
  const [state, dispatch] = useReducer(reducer, {
    items: [],
    isProcessing: false,
    showThinkingIndicator: false,
    currentTasks: null,
    currentFiles: null,
    currentTeam: null,
    currentAgentActivities: null,
    lastActivity: null,
    processingStartedAt: null,
  });
  const instanceIdRef = useRef<string | null>(null);

  const handleMessage = (instanceId: string, message: ServerMessage) => {
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
  };

  const setInstanceId = (id: string | null) => {
    instanceIdRef.current = id;
    dispatch({ type: "reset" });
  };

  const showThinking = () => {
    dispatch({ type: "show_thinking" });
  };

  return {
    items: state.items,
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
