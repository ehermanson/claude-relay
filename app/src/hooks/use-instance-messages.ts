import { useCallback, useReducer, useRef } from "react";
import type {
  ServerMessage,
  ActivityMessage,
  HistoryEntry,
  TaskItem,
  FileChange,
} from "@shared/types";
import type { ChatItem, LiveActivity } from "@/lib/chat-types";

// Re-export for consumers
export type { ChatItem, LiveActivity };

const IMAGE_ONLY_PATTERN = /^\s*(\[Image: source: [^\]]+\]\s*)+$/;

function isImageOnly(text: string): boolean {
  return IMAGE_ONLY_PATTERN.test(text);
}

interface State {
  items: ChatItem[];
  hasLoadedHistory: boolean;
  isProcessing: boolean;
  showThinkingIndicator: boolean;
  currentTasks: TaskItem[] | null;
  currentFiles: FileChange[] | null;
  /** Most recent activity for the live status strip */
  lastActivity: LiveActivity | null;
  /** When the current processing turn started (user sent a message) */
  processingStartedAt: number | null;
  /** Raw history entries for debug/context panel display */
  rawHistory: HistoryEntry[] | null;
  /** Last replay cursor seen for this instance */
  lastSeenSequence: number;
  /** Server replay epoch tied to the current buffered event stream */
  replayEpoch?: number;
}

type Action =
  | { type: "reset" }
  | { type: "restore"; cached: State }
  | {
      type: "replay";
      history: HistoryEntry[];
      replayMode?: "full" | "delta";
      latestSequence?: number;
      replayEpoch?: number;
    }
  | {
      type: "output";
      text: string;
      isWaiting: boolean;
      thinking?: string;
      eventSequence?: number;
    }
  | { type: "activity"; message: ActivityMessage }
  | { type: "user"; text: string; internal?: boolean; queued?: boolean; eventSequence?: number }
  | { type: "clear_queued" }
  | { type: "transcript"; title: string; result: string; eventSequence?: number }
  | { type: "exit"; code: number; signal?: string; stderr?: string; eventSequence?: number }
  | { type: "error"; message: string }
  | { type: "notification"; message: string }
  | { type: "show_thinking" };

// Module-level cache — persists across mounts/unmounts within a page session.
// Switching between sessions restores cached state instantly instead of showing
// a loading spinner while the WS history replay arrives.
const MAX_CACHE_SIZE = 50;
const stateCache = new Map<string, State>();

function setCacheEntry(id: string, state: State) {
  // Evict oldest entries when cache exceeds limit
  if (stateCache.size >= MAX_CACHE_SIZE && !stateCache.has(id)) {
    const oldest = stateCache.keys().next().value;
    if (oldest) stateCache.delete(oldest);
  }
  stateCache.set(id, state);
}

const EMPTY_STATE: State = {
  items: [],
  hasLoadedHistory: false,
  isProcessing: false,
  showThinkingIndicator: false,
  currentTasks: null,
  currentFiles: null,
  lastActivity: null,
  processingStartedAt: null,
  rawHistory: null,
  lastSeenSequence: 0,
  replayEpoch: undefined,
};

function coreReducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return EMPTY_STATE;

    case "restore":
      return action.cached;

    case "replay": {
      const isSafeDelta =
        action.replayMode === "delta" &&
        (state.replayEpoch === undefined || action.replayEpoch === state.replayEpoch) &&
        (action.latestSequence ?? state.lastSeenSequence) >= state.lastSeenSequence;

      if (isSafeDelta) {
        return {
          ...state,
          hasLoadedHistory: true,
          replayEpoch: action.replayEpoch ?? state.replayEpoch,
          lastSeenSequence: action.latestSequence ?? state.lastSeenSequence,
        };
      }

      // Replay history to rebuild items
      let items: ChatItem[] = [];
      let assistantText = "";
      let assistantTimestamp: number | undefined;
      let currentActivities: ActivityMessage[] = [];
      let currentTasks: TaskItem[] | null = null;
      let currentFiles: FileChange[] | null = null;

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
            // Hide programmatically-injected messages (e.g. auto-continue after restart)
            if (msg.internal) break;
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
              items.push({
                kind: "user",
                text: msg.text,
                timestamp: entry.timestamp,
                queued: msg.queued,
              });
            }
            break;
          }
          case "activity":
            if (msg.activity === "task_list" && msg.tasks) {
              currentTasks = msg.tasks;
            } else if (msg.activity === "file_list" && msg.files) {
              currentFiles = msg.files;
            } else if (msg.activity === "thinking") {
              flushAssistant();
              flushActivities();
              items.push({ kind: "thinking-block", text: msg.detail || "" });
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
                ? `Chat process killed by ${msg.signal}`
                : `Chat process exited with code ${msg.code}`;
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
        lastActivity: null,
        processingStartedAt: null,
        rawHistory: action.history,
        replayEpoch: action.replayEpoch,
        lastSeenSequence: action.latestSequence ?? 0,
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
      } else if (action.message.activity === "thinking") {
        const items = [...state.items];
        items.push({ kind: "thinking-block", text: action.message.detail || "" });
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
                : now,
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
      return {
        ...state,
        items,
        showThinkingIndicator: false,
      };
    }

    case "user": {
      // Hide programmatically-injected messages (e.g. auto-continue after restart)
      if (action.internal) return state;
      const items = [...state.items];
      const now = Date.now();

      // When the queue drains, the server sends one coalesced non-queued user
      // message that replaces all the queued placeholders.  Strip the old
      // placeholders so we don't show duplicates.
      if (!action.queued) {
        const hadQueued = items.some((i) => i.kind === "user" && i.queued);
        if (hadQueued) {
          // Remove all queued placeholders — the real message replaces them
          for (let i = items.length - 1; i >= 0; i--) {
            if (items[i].kind === "user" && (items[i] as { queued?: boolean }).queued) {
              items.splice(i, 1);
            }
          }
        }
      }

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
        return {
          ...state,
          items,
          showThinkingIndicator: false,
        };
      }
      items.push({ kind: "user", text: action.text, timestamp: now, queued: action.queued });
      return {
        ...state,
        items,
        showThinkingIndicator: false,
        processingStartedAt: action.queued ? state.processingStartedAt : now,
      };
    }

    case "clear_queued": {
      const hadQueued = state.items.some((i) => i.kind === "user" && i.queued);
      if (!hadQueued) return state;
      return {
        ...state,
        items: state.items.filter((i) => !(i.kind === "user" && i.queued)),
      };
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

    case "notification": {
      const items = [...state.items];
      items.push({ kind: "system", text: action.message });
      return { ...state, items };
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

function getActionSequence(action: Action): number | undefined {
  switch (action.type) {
    case "output":
    case "user":
    case "transcript":
    case "exit":
      return action.eventSequence;
    case "activity":
      return action.message.eventSequence;
    default:
      return undefined;
  }
}

function reducer(state: State, action: Action): State {
  const seq = getActionSequence(action);
  if (seq !== undefined && seq <= state.lastSeenSequence) {
    return state;
  }
  const next = coreReducer(state, action);
  if (seq === undefined) return next;
  return {
    ...next,
    lastSeenSequence: seq,
  };
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
          dispatch({
            type: "replay",
            history: message.history,
            replayMode: message.replayMode,
            latestSequence: message.latestSequence,
            replayEpoch: message.replayEpoch,
          });
        }
        break;
      case "output":
        if (message.instanceId === instanceId) {
          dispatch({
            type: "output",
            text: message.text,
            isWaiting: message.isWaiting,
            thinking: message.thinking,
            eventSequence: message.eventSequence,
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
          dispatch({
            type: "user",
            text: message.text,
            internal: message.internal,
            queued: message.queued,
            eventSequence: message.eventSequence,
          });
        }
        break;
      case "transcript":
        if (message.instanceId === instanceId) {
          dispatch({
            type: "transcript",
            title: message.title,
            result: message.result,
            eventSequence: message.eventSequence,
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
            eventSequence: message.eventSequence,
          });
        }
        break;
      case "error":
        if (!message.instanceId || message.instanceId === instanceId) {
          dispatch({ type: "error", message: message.message });
        }
        break;
      case "notification":
        if (!message.instanceId || message.instanceId === instanceId) {
          dispatch({ type: "notification", message: message.message });
        }
        break;
      case "instance_status":
        // When the server clears the message queue (turn ended or stop pressed),
        // remove any queued placeholder bubbles that are still visible.
        if (message.instanceId === instanceId && !message.instance.queuedMessageCount) {
          dispatch({ type: "clear_queued" });
        }
        break;
    }
  }, []);

  const setInstanceId = useCallback((id: string | null) => {
    // Save outgoing instance's state to cache
    const prevId = instanceIdRef.current;
    if (prevId && stateRef.current.hasLoadedHistory) {
      setCacheEntry(prevId, stateRef.current);
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

  const getReplayCursor = useCallback((instanceId: string) => {
    const source =
      instanceIdRef.current === instanceId ? stateRef.current : stateCache.get(instanceId);
    if (!source || source.lastSeenSequence <= 0 || source.replayEpoch === undefined) {
      return undefined;
    }
    return {
      lastSeenSequence: source.lastSeenSequence,
      replayEpoch: source.replayEpoch,
    };
  }, []);

  return {
    items: state.items,
    hasLoadedHistory: state.hasLoadedHistory,
    isProcessing: state.isProcessing,
    showThinkingIndicator: state.showThinkingIndicator,
    currentTasks: state.currentTasks,
    currentFiles: state.currentFiles,
    lastActivity: state.lastActivity,
    processingStartedAt: state.processingStartedAt,
    rawHistory: state.rawHistory,
    getReplayCursor,
    handleMessage,
    setInstanceId,
    showThinking,
  };
}
