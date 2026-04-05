import { useCallback, useReducer, useRef } from "react";
import type {
  ServerMessage,
  ActivityMessage,
  HistoryEntry,
  TaskItem,
  FileChange,
  SystemEventMessage,
} from "@shared/types";
import type { ChatItem, LiveActivity, MergedActivity } from "@/lib/chat-types";
import { INTERACTIVE_TOOLS } from "@shared/tools";

// Re-export for consumers
export type { ChatItem, LiveActivity };

const IMAGE_ONLY_PATTERN = /^\s*(\[Image: source: [^\]]+\]\s*)+$/;
const GENERIC_LIVE_STRIP_TOOLS = new Set(["Edit", "Write", "Read", "Grep", "Glob"]);

function isImageOnly(text: string): boolean {
  return IMAGE_ONLY_PATTERN.test(text);
}

function buildLiveActivity(
  update: Omit<LiveActivity, "startedAt">,
  previous?: LiveActivity | null,
): LiveActivity {
  const shouldPreserveStart =
    previous &&
    previous.phase === update.phase &&
    previous.presentation === update.presentation &&
    previous.tool === update.tool &&
    previous.description === update.description;
  return {
    ...update,
    startedAt: shouldPreserveStart ? previous.startedAt : Date.now(),
  };
}

function classifyActivityForStrip(message: ActivityMessage): Omit<LiveActivity, "startedAt"> {
  if (message.activity === "task_list") {
    return {
      phase: "task_list",
      presentation: "generic",
      description: "Updating tasks...",
    };
  }
  if (message.activity === "file_list") {
    return {
      phase: "file_list",
      presentation: "generic",
      description: "Writing files...",
    };
  }
  if (message.activity === "thinking") {
    return {
      phase: "thinking",
      presentation: "generic",
      description: "Thinking...",
    };
  }

  const tool = message.tool;
  const genericTool =
    message.activity === "tool_use" && (tool ? GENERIC_LIVE_STRIP_TOOLS.has(tool) : false);
  return {
    phase: "tool",
    presentation: genericTool ? "generic" : "detailed",
    description: message.description || tool || "Working...",
    tool,
  };
}

function mergeToolResult(activities: MergedActivity[], result: ActivityMessage): boolean {
  // Permission denials stay as separate entries — they have their own UI
  if (result.permissionDenied) return false;
  // Interactive tool resolutions stay separate — handled by resolvedInteractive logic
  if (result.resolution && INTERACTIVE_TOOLS.has(result.tool || "")) return false;

  const status = result.description === "Tool error" ? "error" : "success";

  // Scan backwards for the best tool_use to merge into.
  // Prefer entries with `input` (the original call) over progress updates
  // (which the server emits without `input` for long-running Bash commands).
  let fallbackIdx = -1;
  for (let i = activities.length - 1; i >= 0; i--) {
    const act = activities[i];
    if (act.activity === "tool_use") {
      if (act.input) {
        // Found the original tool_use with input — merge here
        activities[i] = {
          ...act,
          mergedResultDetail: result.detail,
          mergedResultStatus: status,
        };
        return true;
      }
      if (fallbackIdx === -1) fallbackIdx = i;
    }
  }
  // No tool_use with input found — fall back to last tool_use (progress entry)
  if (fallbackIdx !== -1) {
    activities[fallbackIdx] = {
      ...activities[fallbackIdx],
      mergedResultDetail: result.detail,
      mergedResultStatus: status,
    };
    return true;
  }
  return false;
}

/**
 * Process raw history entries into ChatItem[] for display.
 * Extracted so it can be reused outside the hook (e.g. space debug modal).
 */
export function replayHistoryToItems(history: HistoryEntry[]): ChatItem[] {
  let items: ChatItem[] = [];
  let assistantText = "";
  let assistantTimestamp: number | undefined;
  let currentActivities: MergedActivity[] = [];

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

  for (const entry of history) {
    const msg = entry.message;
    switch (msg.type) {
      case "output":
        if (msg.thinking) {
          items.push({ kind: "thinking-block", text: msg.thinking });
        } else if (msg.text && msg.text.trim()) {
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
          // skip — task lists don't produce chat items
        } else if (msg.activity === "file_list" && msg.files) {
          // skip — file lists don't produce chat items
        } else if (msg.activity === "thinking") {
          flushAssistant();
          flushActivities();
          items.push({ kind: "thinking-block", text: msg.detail || "" });
        } else if (msg.activity === "tool_result") {
          // Merge result into the matching tool_use
          flushAssistant();
          if (!mergeToolResult(currentActivities, msg)) {
            // Couldn't merge into unflushed activities — scan backwards through
            // flushed items (past assistant/thinking rows) to find the activity group.
            let merged = false;
            for (let j = items.length - 1; j >= 0; j--) {
              if (items[j].kind === "activity-group") {
                const acts = [
                  ...(items[j] as { kind: "activity-group"; activities: MergedActivity[] })
                    .activities,
                ];
                if (mergeToolResult(acts, msg)) {
                  items[j] = { kind: "activity-group", activities: acts };
                  merged = true;
                } else {
                  // Permission denied / interactive — append as separate entry in the group
                  items[j] = { kind: "activity-group", activities: [...acts, msg] };
                  merged = true;
                }
                break;
              }
              // Only skip past assistant and thinking items
              if (items[j].kind !== "assistant" && items[j].kind !== "thinking-block") break;
            }
            if (!merged) {
              currentActivities.push(msg);
            }
          }
        } else {
          flushAssistant();
          currentActivities.push(msg);
        }
        break;
      case "system_event": {
        flushActivities();
        flushAssistant();
        if (msg.event === "compact_boundary") {
          items.push({ kind: "compact-boundary", timestamp: entry.timestamp });
        }
        break;
      }
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
      case "error":
        flushActivities();
        flushAssistant();
        items.push({ kind: "system", text: `Error: ${msg.message}`, isError: true });
        break;
    }
  }

  flushActivities();
  flushAssistant();

  return items;
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
  | { type: "system_event"; message: SystemEventMessage }
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

export function primeInstanceMessagesCache(instanceId: string): void {
  setCacheEntry(instanceId, {
    ...EMPTY_STATE,
    hasLoadedHistory: true,
    rawHistory: [],
  });
}

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

      const items = replayHistoryToItems(action.history);

      // Extract latest task/file lists from activity messages
      let currentTasks: TaskItem[] | null = null;
      let currentFiles: FileChange[] | null = null;
      for (const entry of action.history) {
        const msg = entry.message;
        if (msg.type === "activity") {
          if (msg.activity === "task_list" && msg.tasks) currentTasks = msg.tasks;
          else if (msg.activity === "file_list" && msg.files) currentFiles = msg.files;
        }
      }

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
          lastActivity: buildLiveActivity(
            {
              phase: "thinking",
              presentation: "generic",
              description: "Thinking...",
            },
            state.lastActivity,
          ),
        };
      }

      if (action.text) {
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
          lastActivity: buildLiveActivity(
            {
              phase: "responding",
              presentation: "generic",
              description: "Responding...",
            },
            state.lastActivity,
          ),
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
      if (action.message.activity === "task_list" && action.message.tasks) {
        return {
          ...state,
          isProcessing: true,
          showThinkingIndicator: true,
          currentTasks: action.message.tasks,
          lastActivity: buildLiveActivity(
            {
              phase: "task_list",
              presentation: "generic",
              description: "Updating tasks...",
            },
            state.lastActivity,
          ),
        };
      } else if (action.message.activity === "file_list" && action.message.files) {
        return {
          ...state,
          isProcessing: true,
          showThinkingIndicator: true,
          currentFiles: action.message.files,
          lastActivity: buildLiveActivity(
            {
              phase: "file_list",
              presentation: "generic",
              description: "Writing files...",
            },
            state.lastActivity,
          ),
        };
      } else if (action.message.activity === "thinking") {
        const items = [...state.items];
        items.push({ kind: "thinking-block", text: action.message.detail || "" });
        return {
          ...state,
          items,
          isProcessing: true,
          showThinkingIndicator: true,
          lastActivity: buildLiveActivity(
            {
              phase: "thinking",
              presentation: "generic",
              description: "Thinking...",
            },
            state.lastActivity,
          ),
        };
      } else {
        const items = [...state.items];
        const msg = action.message;

        if (msg.activity === "tool_result") {
          // Merge tool_result into the matching tool_use entry.
          // The tool_use might be in the last activity group, or in an
          // earlier group (if assistant text streamed between use and result).
          let merged = false;

          // Scan backwards through items to find an activity group
          for (let i = items.length - 1; i >= 0; i--) {
            if (items[i].kind === "activity-group") {
              const group = items[i] as { kind: "activity-group"; activities: MergedActivity[] };
              const acts = [...group.activities];
              if (mergeToolResult(acts, msg)) {
                items[i] = { kind: "activity-group", activities: acts };
                merged = true;
              } else {
                // Couldn't merge (permission denied / interactive result) — append as
                // a separate entry in this group. This is safe because the live reducer
                // processes events sequentially; the most recent activity group always
                // corresponds to the current tool call sequence.
                // NOTE: ID-based matching (via toolUseId) would make this more robust
                // but requires threading the ID through ActivityMessage on the server side.
                items[i] = { kind: "activity-group", activities: [...group.activities, msg] };
                merged = true;
              }
              break;
            }
            // Only skip past assistant and thinking items
            if (items[i].kind !== "assistant" && items[i].kind !== "thinking-block") break;
          }

          if (!merged) {
            // No activity group found — create one (shouldn't normally happen)
            items.push({ kind: "activity-group", activities: [msg] });
          }
        } else {
          // tool_use or other non-result activity — append to current group or create new
          const lastIdx = items.length - 1;
          if (lastIdx >= 0 && items[lastIdx].kind === "activity-group") {
            const group = items[lastIdx] as {
              kind: "activity-group";
              activities: MergedActivity[];
            };
            items[lastIdx] = {
              kind: "activity-group",
              activities: [...group.activities, msg],
            };
          } else {
            items.push({ kind: "activity-group", activities: [msg] });
          }
        }

        // Build a contextual description from the activity
        return {
          ...state,
          items,
          isProcessing: true,
          showThinkingIndicator: true,
          lastActivity: buildLiveActivity(
            classifyActivityForStrip(action.message),
            state.lastActivity,
          ),
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

    case "system_event": {
      if (action.message.event !== "compact_boundary") return state;
      const items = [...state.items];
      items.push({ kind: "compact-boundary", timestamp: Date.now() });
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
      return {
        ...state,
        isProcessing: true,
        showThinkingIndicator: true,
        processingStartedAt: state.processingStartedAt ?? Date.now(),
        lastActivity:
          state.lastActivity ??
          buildLiveActivity({
            phase: "starting",
            presentation: "generic",
            description: "Thinking...",
          }),
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

/**
 * Convert a live action into a ServerMessage so we can append it to rawHistory
 * (keeping raw history in sync with live WS events, not just replay snapshots).
 */
function actionToHistoryEntry(action: Action): HistoryEntry | null {
  const now = Date.now();
  switch (action.type) {
    case "activity":
      return { timestamp: now, message: action.message };
    case "system_event":
      return { timestamp: now, message: action.message };
    case "output":
      return {
        timestamp: now,
        message: {
          type: "output",
          instanceId: "",
          text: action.text,
          isWaiting: action.isWaiting,
          thinking: action.thinking,
        } as ServerMessage,
      };
    case "user":
      return {
        timestamp: now,
        message: {
          type: "user",
          instanceId: "",
          text: action.text,
          internal: action.internal,
          queued: action.queued,
        } as ServerMessage,
      };
    case "exit":
      return {
        timestamp: now,
        message: {
          type: "exit",
          instanceId: "",
          code: action.code,
          signal: action.signal,
          stderr: action.stderr,
        } as ServerMessage,
      };
    default:
      return null;
  }
}

function reducer(state: State, action: Action): State {
  const seq = getActionSequence(action);
  if (seq !== undefined && seq <= state.lastSeenSequence) {
    return state;
  }
  let next = coreReducer(state, action);

  // Append live messages to rawHistory so the debug modal stays current
  const entry = actionToHistoryEntry(action);
  if (entry && next.rawHistory) {
    next = { ...next, rawHistory: [...next.rawHistory, entry] };
  }

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
      case "system_event":
        if (message.instanceId === instanceId) {
          dispatch({ type: "system_event", message });
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
