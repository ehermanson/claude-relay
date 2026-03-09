import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type {
  ActivityMessage,
  HistoryEntry,
  OutputMessage,
  SessionStats,
  UserMessage,
} from "../types.js";

const MAX_HISTORY = 1000;
const TOOL_OUTPUT_MARKER = "\nOutput:\n";

export interface CodexPendingCall {
  name: string;
  arguments?: string;
}

export interface CodexReplayContext {
  pendingCalls: Map<string, CodexPendingCall>;
  stats: SessionStats;
}

export interface CodexTranscriptParseResult {
  cwd: string;
  history: HistoryEntry[];
  stats: SessionStats;
}

function createZeroStats(): SessionStats {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUSD: 0,
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

    if (payload.type === "function_call" && typeof payload.name === "string") {
      if (typeof payload.call_id === "string") {
        ctx.pendingCalls.set(payload.call_id, {
          name: payload.name,
          arguments: typeof payload.arguments === "string" ? payload.arguments : undefined,
        });
      }
      results.push({
        timestamp,
        message: buildToolUseActivity(payload.name, payload.arguments),
      });
    } else if (payload.type === "function_call_output") {
      const callId = typeof payload.call_id === "string" ? payload.call_id : undefined;
      const call = callId ? ctx.pendingCalls.get(callId) : undefined;
      if (callId) ctx.pendingCalls.delete(callId);
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
        }

        if (last) {
          const inputTokens = typeof last.input_tokens === "number" ? last.input_tokens : 0;
          const cacheReadTokens =
            typeof last.cached_input_tokens === "number" ? last.cached_input_tokens : 0;
          ctx.stats.contextTokens = inputTokens + cacheReadTokens;
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
      history: [],
      stats: createZeroStats(),
    };
  }

  let cwd = "";
  const history: HistoryEntry[] = [];
  const ctx: CodexReplayContext = {
    pendingCalls: new Map(),
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
    history,
    stats: ctx.stats,
  };
}
