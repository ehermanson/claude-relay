import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type {
  ActivityMessage,
  FileChange,
  HistoryEntry,
  OutputMessage,
  SessionStats,
  TaskItem,
  UserMessage,
} from "../types.js";
import { buildTaskListActivityFromPlan } from "../tools.js";

const MAX_HISTORY = 1000;
const TOOL_OUTPUT_MARKER = "\nOutput:\n";

export interface CodexPendingCall {
  name: string;
  arguments?: string;
}

export interface CodexReplayContext {
  pendingCalls: Map<string, CodexPendingCall>;
  tasks: Map<string, TaskItem>;
  files: Map<string, FileChange>;
  stats: SessionStats;
}

export interface CodexTranscriptParseResult {
  cwd: string;
  tasks: Map<string, TaskItem>;
  files: Map<string, FileChange>;
  history: HistoryEntry[];
  stats: SessionStats;
}

function createZeroStats(): SessionStats {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
}

function parseTimestamp(timestamp: unknown): number {
  if (typeof timestamp !== "string") return Date.now();
  const parsed = new Date(timestamp).getTime();
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function parseArguments(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizeToolOutput(output: unknown): string {
  if (typeof output !== "string") return "";
  const markerIndex = output.lastIndexOf(TOOL_OUTPUT_MARKER);
  const normalized =
    markerIndex >= 0 ? output.slice(markerIndex + TOOL_OUTPUT_MARKER.length) : output;
  return normalized.trim();
}

function trackFileChange(files: Map<string, FileChange>, path: string, type: "added" | "edited") {
  const existing = files.get(path);
  if (existing) {
    existing.editCount++;
    if (existing.type !== "added") existing.type = type;
    return;
  }
  files.set(path, { path, editCount: 1, type });
}

function extractPatchFiles(patch: string): Array<{ path: string; type: "added" | "edited" }> {
  const files = new Map<string, { path: string; type: "added" | "edited" }>();
  let pendingPath: string | null = null;
  let pendingType: "added" | "edited" = "edited";

  for (const rawLine of patch.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.startsWith("*** Add File: ")) {
      pendingPath = line.slice("*** Add File: ".length).trim();
      pendingType = "added";
      files.set(pendingPath, { path: pendingPath, type: pendingType });
      continue;
    }
    if (line.startsWith("*** Update File: ")) {
      pendingPath = line.slice("*** Update File: ".length).trim();
      pendingType = "edited";
      files.set(pendingPath, { path: pendingPath, type: pendingType });
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      pendingPath = line.slice("*** Delete File: ".length).trim();
      pendingType = "edited";
      files.set(pendingPath, { path: pendingPath, type: pendingType });
      continue;
    }
    if (line.startsWith("*** Move to: ") && pendingPath) {
      const movedPath = line.slice("*** Move to: ".length).trim();
      files.delete(pendingPath);
      pendingPath = movedPath;
      files.set(movedPath, { path: movedPath, type: pendingType });
    }
  }

  return Array.from(files.values());
}

function buildToolUseActivity(name: string, rawArguments: unknown): ActivityMessage {
  const parsedArgs = parseArguments(rawArguments);
  if (name === "exec_command") {
    const command = typeof parsedArgs?.cmd === "string" ? parsedArgs.cmd : undefined;
    return {
      type: "activity",
      activity: "tool_use",
      tool: "Bash",
      description: command ? "Running command" : "Running command",
      detail: command,
      input: command ? { command } : undefined,
      inputDescription: command,
    };
  }

  return {
    type: "activity",
    activity: "tool_use",
    tool: name,
    description: `Using ${name}`,
    detail: typeof rawArguments === "string" && rawArguments.length > 0 ? rawArguments : undefined,
    input: parsedArgs,
  };
}

function buildToolResultActivity(
  call: CodexPendingCall | undefined,
  rawOutput: unknown,
): ActivityMessage {
  const detail = normalizeToolOutput(rawOutput);
  const parsedArgs = parseArguments(call?.arguments);

  if (call?.name === "exec_command") {
    const command = typeof parsedArgs?.cmd === "string" ? parsedArgs.cmd : undefined;
    const exitMatch =
      typeof rawOutput === "string" ? rawOutput.match(/Process exited with code (\d+)/) : null;
    const exitCode = exitMatch ? Number.parseInt(exitMatch[1], 10) : undefined;
    const succeeded = exitCode == null || exitCode === 0;
    return {
      type: "activity",
      activity: "tool_result",
      tool: "Bash",
      description: succeeded ? "Command completed" : "Command failed",
      detail: detail || command,
      input: command ? { command, exitCode } : exitCode != null ? { exitCode } : undefined,
      inputDescription: command,
    };
  }

  return {
    type: "activity",
    activity: "tool_result",
    tool: call?.name,
    description: "Tool completed",
    detail: detail || undefined,
    input: parsedArgs,
  };
}

export function convertCodexTranscriptEntry(
  entry: Record<string, unknown>,
  ctx: CodexReplayContext,
): HistoryEntry[] {
  const timestamp = parseTimestamp(entry.timestamp);
  const results: HistoryEntry[] = [];

  if (entry.type === "response_item") {
    const payload =
      typeof entry.payload === "object" && entry.payload !== null
        ? (entry.payload as Record<string, unknown>)
        : null;
    if (!payload) return results;

    if (
      (payload.type === "function_call" || payload.type === "custom_tool_call") &&
      typeof payload.name === "string"
    ) {
      const rawArguments =
        typeof payload.arguments === "string" ? payload.arguments : payload.input;
      if (typeof payload.call_id === "string") {
        ctx.pendingCalls.set(payload.call_id, {
          name: payload.name,
          arguments:
            typeof payload.arguments === "string"
              ? payload.arguments
              : typeof payload.input === "string"
                ? payload.input
                : undefined,
        });
      }
      const taskListActivity =
        payload.name === "update_plan" ? buildTaskListActivityFromPlan(rawArguments) : undefined;
      if (taskListActivity) {
        ctx.tasks.clear();
        for (const task of taskListActivity.tasks ?? []) {
          ctx.tasks.set(task.id, { ...task });
        }
        results.push({ timestamp, message: taskListActivity });
      } else {
        results.push({
          timestamp,
          message: buildToolUseActivity(payload.name, rawArguments),
        });
      }
      if (payload.name === "apply_patch" && typeof payload.input === "string") {
        for (const file of extractPatchFiles(payload.input)) {
          trackFileChange(ctx.files, file.path, file.type);
        }
        if (ctx.files.size > 0) {
          results.push({
            timestamp,
            message: {
              type: "activity",
              activity: "file_list",
              description: "Files changed",
              files: Array.from(ctx.files.values()).map((file) => ({ ...file })),
            } as ActivityMessage,
          });
        }
      }
    } else if (
      payload.type === "function_call_output" ||
      payload.type === "custom_tool_call_output"
    ) {
      const callId = typeof payload.call_id === "string" ? payload.call_id : undefined;
      const call = callId ? ctx.pendingCalls.get(callId) : undefined;
      if (callId) ctx.pendingCalls.delete(callId);
      if (call?.name === "update_plan") return results;
      results.push({
        timestamp,
        message: buildToolResultActivity(call, payload.output),
      });
    }

    return results;
  }

  if (entry.type === "event_msg") {
    const payload =
      typeof entry.payload === "object" && entry.payload !== null
        ? (entry.payload as Record<string, unknown>)
        : null;
    if (!payload || typeof payload.type !== "string") return results;

    switch (payload.type) {
      case "user_message":
        if (typeof payload.message === "string" && payload.message.trim()) {
          results.push({
            timestamp,
            message: {
              type: "user",
              text: payload.message,
            } as UserMessage,
          });
        }
        break;

      case "agent_reasoning":
        if (typeof payload.text === "string" && payload.text.trim()) {
          results.push({
            timestamp,
            message: {
              type: "activity",
              activity: "thinking",
              description: "Reasoning...",
              detail: payload.text,
            } as ActivityMessage,
          });
        }
        break;

      case "agent_message":
        if (typeof payload.message === "string" && payload.message.trim()) {
          results.push({
            timestamp,
            message: {
              type: "output",
              text: payload.message,
              isWaiting: false,
            } as OutputMessage,
          });
        }
        break;

      case "plan_update": {
        const activity = buildTaskListActivityFromPlan(payload);
        if (activity) {
          ctx.tasks.clear();
          for (const task of activity.tasks ?? []) {
            ctx.tasks.set(task.id, { ...task });
          }
          results.push({
            timestamp,
            message: activity,
          });
        }
        break;
      }

      case "task_complete":
        results.push({
          timestamp,
          message: {
            type: "output",
            text: "",
            isWaiting: true,
          } as OutputMessage,
        });
        break;

      case "token_count": {
        const info =
          typeof payload.info === "object" && payload.info !== null
            ? (payload.info as Record<string, unknown>)
            : null;
        const total =
          info && typeof info.total_token_usage === "object" && info.total_token_usage !== null
            ? (info.total_token_usage as Record<string, unknown>)
            : null;
        const last =
          info && typeof info.last_token_usage === "object" && info.last_token_usage !== null
            ? (info.last_token_usage as Record<string, unknown>)
            : null;

        if (total) {
          ctx.stats.inputTokens =
            typeof total.input_tokens === "number" ? total.input_tokens : ctx.stats.inputTokens;
          ctx.stats.cacheReadTokens =
            typeof total.cached_input_tokens === "number"
              ? total.cached_input_tokens
              : ctx.stats.cacheReadTokens;
          ctx.stats.outputTokens =
            typeof total.output_tokens === "number" ? total.output_tokens : ctx.stats.outputTokens;
          if (typeof total.reasoning_output_tokens === "number") {
            ctx.stats.reasoningTokens = total.reasoning_output_tokens;
          }
        }

        if (last) {
          const inputTokens = typeof last.input_tokens === "number" ? last.input_tokens : 0;
          // Codex cached_input_tokens are already included in input_tokens.
          ctx.stats.contextTokens = inputTokens;
        }
        if (info && typeof info.model_context_window === "number") {
          ctx.stats.contextWindow = info.model_context_window;
        }
        break;
      }

      case "turn_context":
        if (typeof payload.model === "string" && payload.model.trim()) {
          ctx.stats.model = payload.model;
        }
        break;

      default:
        break;
    }
  }

  if (entry.type === "turn_context") {
    const payload =
      typeof entry.payload === "object" && entry.payload !== null
        ? (entry.payload as Record<string, unknown>)
        : null;
    if (payload && typeof payload.model === "string" && payload.model.trim()) {
      ctx.stats.model = payload.model;
    }
  }

  return results;
}

function fileMatchesSessionId(filePath: string, sessionId: string): boolean {
  try {
    const firstLine = readFileSync(filePath, "utf-8").split("\n", 1)[0];
    if (!firstLine) return false;
    const parsed = JSON.parse(firstLine) as {
      type?: string;
      payload?: { id?: string };
    };
    return parsed.type === "session_meta" && parsed.payload?.id === sessionId;
  } catch {
    return false;
  }
}

export function findCodexTranscriptPath(codexDir: string, sessionId: string): string | undefined {
  const sessionsDir = join(codexDir, "sessions");
  if (!existsSync(sessionsDir)) return undefined;

  const stack = [sessionsDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const entryName of entries) {
      const fullPath = join(dir, entryName);
      if (entryName === ".DS_Store") continue;

      try {
        if (statSync(fullPath).isDirectory()) {
          stack.push(fullPath);
          continue;
        }
      } catch {
        continue;
      }

      if (!entryName.endsWith(".jsonl") || !entryName.includes(sessionId)) continue;
      if (fileMatchesSessionId(fullPath, sessionId)) return fullPath;
    }
  }

  return undefined;
}

export function parseCodexTranscript(filePath: string): CodexTranscriptParseResult {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return {
      cwd: "",
      tasks: new Map(),
      files: new Map(),
      history: [],
      stats: createZeroStats(),
    };
  }

  let cwd = "";
  const history: HistoryEntry[] = [];
  const ctx: CodexReplayContext = {
    pendingCalls: new Map(),
    tasks: new Map(),
    files: new Map(),
    stats: createZeroStats(),
  };

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (!cwd && entry.type === "session_meta") {
        const payload =
          typeof entry.payload === "object" && entry.payload !== null
            ? (entry.payload as Record<string, unknown>)
            : null;
        if (payload && typeof payload.cwd === "string") {
          cwd = payload.cwd;
        }
      }

      const converted = convertCodexTranscriptEntry(entry, ctx);
      history.push(...converted);
    } catch {
      // Skip malformed lines.
    }
  }

  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  return {
    cwd,
    tasks: ctx.tasks,
    files: ctx.files,
    history,
    stats: ctx.stats,
  };
}
