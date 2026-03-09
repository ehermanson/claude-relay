import type { FileChange, HistoryEntry, ProviderKind, TranscriptMessage } from "./types.js";

const MAX_RECENT_MESSAGES = 8;
const MAX_LINE_LENGTH = 400;
const MAX_SECTION_LENGTH = 2400;
const MAX_CHANGED_FILES = 8;

interface HandoffMessage {
  role: "User" | "Assistant";
  text: string;
}

export interface ProviderSwitchHandoffOptions {
  sourceProvider: ProviderKind;
  targetProvider: ProviderKind;
  sourceName?: string;
  workingDirectory: string;
  history: HistoryEntry[];
  changedFiles?: FileChange[] | null;
}

function clip(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}...`;
}

function normalizeMessageText(text: string): string {
  return clip(text.replace(/\s+/g, " "), MAX_LINE_LENGTH);
}

function collectRecentConversation(history: HistoryEntry[]): HandoffMessage[] {
  const messages: HandoffMessage[] = [];

  for (const entry of history) {
    const message = entry.message;
    if (message.type === "user") {
      const text = normalizeMessageText(message.text);
      if (text) messages.push({ role: "User", text });
      continue;
    }

    if (message.type === "output" && !message.isWaiting) {
      const text = normalizeMessageText(message.text);
      if (text) messages.push({ role: "Assistant", text });
      continue;
    }

    if (message.type === "transcript") {
      const transcript = message as TranscriptMessage;
      const text = normalizeMessageText(`Agent result (${transcript.title}): ${transcript.result}`);
      if (text) messages.push({ role: "Assistant", text });
    }
  }

  return messages.slice(-MAX_RECENT_MESSAGES);
}

function buildConversationSection(history: HistoryEntry[]): string {
  const recent = collectRecentConversation(history);
  if (recent.length === 0) return "";

  const body = recent.map((message) => `${message.role}: ${message.text}`).join("\n");
  return clip(body, MAX_SECTION_LENGTH);
}

function buildChangedFilesSection(changedFiles?: FileChange[] | null): string {
  if (!changedFiles || changedFiles.length === 0) return "";

  return changedFiles
    .slice(0, MAX_CHANGED_FILES)
    .map((file) => `- ${file.path}`)
    .join("\n");
}

export function buildProviderSwitchHandoffPrompt(options: ProviderSwitchHandoffOptions): string {
  const parts = [
    `You are starting a new ${options.targetProvider} session that is taking over from a previous ${options.sourceProvider} session.`,
    "This is a new chat, so do not assume any hidden provider state carries over. Use only the context below.",
    `Working directory: ${options.workingDirectory}`,
  ];

  if (options.sourceName?.trim()) {
    parts.push(`Previous chat title: ${options.sourceName.trim()}`);
  }

  const conversation = buildConversationSection(options.history);
  if (conversation) {
    parts.push("Recent conversation:");
    parts.push(conversation);
  }

  const changedFiles = buildChangedFilesSection(options.changedFiles);
  if (changedFiles) {
    parts.push("Files changed in the previous chat:");
    parts.push(changedFiles);
  }

  parts.push(
    "Continue from the latest user intent. If anything is unclear from the transferred context, say so briefly and inspect the workspace before acting.",
  );

  return parts.join("\n\n");
}
