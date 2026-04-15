/**
 * SpinOffManager — generates and persists structured spin-off packets.
 *
 * Owns the spin-off lifecycle:
 * 1. Assemble bounded source inputs from a chat
 * 2. Generate a structured sparse packet (server-side, dedicated prompt)
 * 3. Persist the spin-off object with provenance links
 * 4. Mark as sent when delivered to the target chat
 */

import { randomBytes } from "node:crypto";
import type { SessionDB, SpinOffRow } from "#core/db.js";
import type { Logger } from "#core/logger.js";
import type { SpinOffInfo, SpinOffPacket, HistoryEntry, FileChange } from "#core/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RECENT_MESSAGES = 20;
const MAX_LINE_LENGTH = 600;
const MAX_SECTION_LENGTH = 4000;
const MAX_CHANGED_FILES = 15;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return randomBytes(4).toString("hex");
}

function clip(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}...`;
}

function normalizeText(text: string): string {
  return clip(text.replace(/\s+/g, " "), MAX_LINE_LENGTH);
}

interface SpinOffMessage {
  role: "User" | "Assistant";
  text: string;
}

function collectRecentMessages(
  history: HistoryEntry[],
  anchorIndex?: number | null,
): SpinOffMessage[] {
  const messages: SpinOffMessage[] = [];
  // Map from history entry index → filtered message index so the client-provided
  // anchor (which is a history/ChatItem index) resolves to the right position in
  // the filtered user+assistant array.
  let anchorMsgIdx: number | undefined;

  for (let i = 0; i < history.length; i++) {
    const msg = history[i].message;
    if (msg.type === "user" && !("internal" in msg && msg.internal)) {
      const text = normalizeText(msg.text);
      if (text) {
        if (anchorIndex != null && i === anchorIndex) anchorMsgIdx = messages.length;
        messages.push({ role: "User", text });
      }
    } else if (msg.type === "output" && !msg.isWaiting) {
      const text = normalizeText(msg.text);
      if (text) {
        if (anchorIndex != null && i === anchorIndex) anchorMsgIdx = messages.length;
        messages.push({ role: "Assistant", text });
      }
    }
  }

  // If an anchor index is provided, bias toward that region
  const resolved = anchorMsgIdx ?? (anchorIndex != null ? anchorIndex : undefined);
  if (resolved != null && resolved >= 0 && resolved < messages.length) {
    const start = Math.max(0, resolved - Math.floor(MAX_RECENT_MESSAGES / 2));
    return messages.slice(start, start + MAX_RECENT_MESSAGES);
  }

  return messages.slice(-MAX_RECENT_MESSAGES);
}

// ---------------------------------------------------------------------------
// Packet generation (template approach — no LLM call for v1)
// ---------------------------------------------------------------------------

interface GeneratePacketOptions {
  chatName: string;
  history: HistoryEntry[];
  changedFiles?: FileChange[] | null;
  anchorIndex?: number | null;
}

/**
 * Build a compact conversation excerpt from recent messages.
 * Returns a readable digest the user can reference while editing.
 */
function buildConversationExcerpt(messages: SpinOffMessage[]): string {
  if (messages.length === 0) return "";
  const lines: string[] = [];
  for (const m of messages) {
    const prefix = m.role === "User" ? "**User:**" : "**Assistant:**";
    lines.push(`${prefix} ${clip(m.text, 300)}`);
  }
  return lines.join("\n");
}

/**
 * Generate a spin-off packet from bounded chat inputs.
 *
 * The current product direction is a lightweight "spin off" flow: pre-fill
 * only factual, high-confidence context and let the user add the actual ask.
 *
 * Designed to be async-ready — swap in LLM-based generation later when a
 * lightweight model call is available.
 */
export function generateSpinOffPacket(options: GeneratePacketOptions): SpinOffPacket {
  const { history, changedFiles, anchorIndex } = options;
  const recent = collectRecentMessages(history, anchorIndex);
  const packet: SpinOffPacket = {};

  // Current state: build a conversation excerpt so the user has context to
  // work from when editing the draft. Much more useful than a single message.
  const excerpt = buildConversationExcerpt(recent);
  if (excerpt) {
    packet.currentState = clip(excerpt, MAX_SECTION_LENGTH);
  }

  // Touched files — this is factual data we can always include
  if (changedFiles && changedFiles.length > 0) {
    packet.touchedFiles = changedFiles
      .slice(0, MAX_CHANGED_FILES)
      .map((f) => f.path)
      .join("\n");
  }

  return packet;
}

// ---------------------------------------------------------------------------
// Packet rendering
// ---------------------------------------------------------------------------

export function renderSpinOffPacket(packet: SpinOffPacket, sourceChatName?: string | null): string {
  const sections: string[] = [];

  if (sourceChatName) {
    sections.push(`[Spun off from: ${sourceChatName}]`);
    sections.push("");
  }

  if (packet.currentState) {
    sections.push(`## Context\n${packet.currentState}`);
  }
  if (packet.touchedFiles) {
    sections.push(`## Touched files\n${packet.touchedFiles}`);
  }

  return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Row <-> Info conversion
// ---------------------------------------------------------------------------

function rowToInfo(row: SpinOffRow): SpinOffInfo {
  return {
    id: row.id,
    sourceChatId: row.source_chat_id,
    sourceChatName: row.source_chat_name,
    targetChatId: row.target_chat_id,
    targetChatName: row.target_chat_name,
    sourceAnchorMessageIndex: row.source_anchor_message_index,
    packet: JSON.parse(row.packet_json) as SpinOffPacket,
    status: row.status as SpinOffInfo["status"],
    createdAt: row.created_at,
    sentAt: row.sent_at,
  };
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class SpinOffManager {
  db: SessionDB;
  logger: Logger;

  constructor(db: SessionDB, logger: Logger) {
    this.db = db;
    this.logger = logger;
  }

  /**
   * Create a new spin-off draft from a source chat.
   */
  createSpinOff(options: {
    sourceChatId: string;
    sourceChatName: string | null;
    history: HistoryEntry[];
    changedFiles?: FileChange[] | null;
    anchorIndex?: number | null;
  }): SpinOffInfo {
    const id = generateId();
    const now = Date.now();

    const packet = generateSpinOffPacket({
      chatName: options.sourceChatName ?? "New Chat",
      history: options.history,
      changedFiles: options.changedFiles,
      anchorIndex: options.anchorIndex,
    });

    const row: SpinOffRow = {
      id,
      source_chat_id: options.sourceChatId,
      source_chat_name: options.sourceChatName ?? null,
      target_chat_id: null,
      target_chat_name: null,
      source_anchor_message_index: options.anchorIndex ?? null,
      packet_json: JSON.stringify(packet),
      status: "draft",
      created_at: now,
      sent_at: null,
    };

    this.db.insertSpinOff(row);
    this.logger.info(`[SpinOffManager] Created spin-off ${id} from chat ${options.sourceChatId}`);

    return rowToInfo(row);
  }

  /**
   * Mark a spin-off as sent to a target chat.
   */
  markSent(
    spinOffId: string,
    targetChatId: string,
    targetChatName: string | null,
  ): SpinOffInfo | null {
    const now = Date.now();
    this.db.updateSpinOffStatus(spinOffId, "sent", targetChatId, targetChatName, now);
    const row = this.db.getSpinOff(spinOffId);
    if (!row) return null;
    this.logger.info(`[SpinOffManager] Spin-off ${spinOffId} sent to chat ${targetChatId}`);
    return rowToInfo(row);
  }

  /**
   * Get a single spin-off by ID.
   */
  getSpinOff(id: string): SpinOffInfo | null {
    const row = this.db.getSpinOff(id);
    return row ? rowToInfo(row) : null;
  }

  /**
   * Get all spin-offs sent FROM a chat.
   */
  getSpinOffsFromChat(chatId: string): SpinOffInfo[] {
    return this.db.getSpinOffsBySourceChat(chatId).map(rowToInfo);
  }

  /**
   * Get all spin-offs received BY a chat.
   */
  getSpinOffsToChat(chatId: string): SpinOffInfo[] {
    return this.db.getSpinOffsByTargetChat(chatId).map(rowToInfo);
  }

  /**
   * Render a spin-off packet to markdown for use as a message.
   */
  renderPacket(spinOffId: string): string | null {
    const info = this.getSpinOff(spinOffId);
    if (!info) return null;
    return renderSpinOffPacket(info.packet, info.sourceChatName);
  }
}
