import type { FileChange, HistoryEntry, ProviderKind, TranscriptMessage } from "#core/types.js";

interface HandoffMessage {
  role: "User" | "Assistant" | "Activity";
  text: string;
}

interface ProviderSwitchHandoffOptions {
  sourceProvider: ProviderKind;
  targetProvider: ProviderKind;
  sourceName?: string;
  workingDirectory: string;
  history: HistoryEntry[];
  changedFiles?: FileChange[] | null;
}

function normalizeMessageText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

function collectConversation(history: HistoryEntry[]): HandoffMessage[] {
  const messages: HandoffMessage[] = [];

  for (const entry of history) {
    const message = entry.message;
    if (message.type === "user") {
      if (message.internal) continue;
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
      continue;
    }

    if (message.type === "activity") {
      const pieces = [message.description, message.detail].filter(
        (piece): piece is string => typeof piece === "string" && piece.trim().length > 0,
      );
      const text = normalizeMessageText(
        [message.tool ? `${message.activity} (${message.tool})` : message.activity, ...pieces].join(
          ": ",
        ),
      );
      if (text) messages.push({ role: "Activity", text });
    }
  }

  return messages;
}

function buildConversationSection(history: HistoryEntry[]): string {
  const conversation = collectConversation(history);
  if (conversation.length === 0) return "";

  return conversation.map((message) => `${message.role}: ${message.text}`).join("\n\n");
}

function buildChangedFilesSection(changedFiles?: FileChange[] | null): string {
  if (!changedFiles || changedFiles.length === 0) return "";

  return changedFiles.map((file) => `- ${file.path}`).join("\n");
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
    parts.push("Full visible transcript:");
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
