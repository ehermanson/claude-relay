/**
 * Shared type definitions for chat message components.
 *
 * Named types for each row variant (instead of inline unions), plus
 * shared enums/literals used across multiple components.
 */

import type { ActivityMessage } from "@shared/types";

// ── Activity types ──────────────────────────────────────────────────

export type ActivityKind = "tool_use" | "tool_result" | "thinking" | "task_list" | "file_list";
export type Resolution = "approved" | "dismissed" | "feedback";
export type ResultStatus = "success" | "error";

// ── ChatItem variants (source data from use-instance-messages) ──────

export interface UserChatItem {
  kind: "user";
  text: string;
  timestamp?: number;
  queued?: boolean;
}

export interface AssistantChatItem {
  kind: "assistant";
  text: string;
  timestamp?: number;
}

export interface SystemChatItem {
  kind: "system";
  text: string;
  isError?: boolean;
}

export interface ThinkingBlockChatItem {
  kind: "thinking-block";
  text: string;
}

export interface ActivityGroupChatItem {
  kind: "activity-group";
  activities: ActivityMessage[];
}

export interface AgentTranscriptChatItem {
  kind: "agent-transcript";
  title: string;
  result: string;
  timestamp?: number;
}

export type ChatItem =
  | UserChatItem
  | AssistantChatItem
  | SystemChatItem
  | ThinkingBlockChatItem
  | ActivityGroupChatItem
  | AgentTranscriptChatItem;

// ── RenderRow variants (processed for the virtualizer) ──────────────

export interface UserRow {
  id: string;
  kind: "user";
  text: string;
  timestamp?: number;
  queued?: boolean;
}

export interface AssistantRow {
  id: string;
  kind: "assistant";
  text: string;
  timestamp?: number;
  isLast: boolean;
}

export interface SystemRow {
  id: string;
  kind: "system";
  text: string;
  isError?: boolean;
}

export interface ThinkingBlockRow {
  id: string;
  kind: "thinking-block";
  text: string;
}

export interface AgentTranscriptRow {
  id: string;
  kind: "agent-transcript";
  title: string;
  result: string;
  timestamp?: number;
}

export interface ResponseDividerRow {
  id: string;
  kind: "response-divider";
  durationLabel: string;
}

export interface ToolGroupData {
  activities: ActivityMessage[];
  originalIndex: number;
  isLastActivityGroup: boolean;
  trailingResolution?: Resolution;
  skipLeadingResult?: boolean;
}

export interface ToolContainerRow {
  id: string;
  kind: "tool-container";
  groups: ToolGroupData[];
  allActivities: ActivityMessage[];
}

export type RenderRow =
  | UserRow
  | AssistantRow
  | SystemRow
  | ThinkingBlockRow
  | AgentTranscriptRow
  | ResponseDividerRow
  | ToolContainerRow;

// ── Live activity (for status strip) ────────────────────────────────

export interface LiveActivity {
  /** Human-readable description of what's happening */
  description: string;
  /** Tool name if applicable */
  tool?: string;
  /** When this specific activity started */
  startedAt: number;
}
