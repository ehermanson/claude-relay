/**
 * Shared type definitions for chat message components.
 *
 * Named types for each row variant (instead of inline unions), plus
 * shared enums/literals used across multiple components.
 */

import type { ActivityMessage } from "@shared/types";
import type { LargeUserRenderMode } from "@/lib/message-rendering";

// ── Activity types ──────────────────────────────────────────────────

export type ActivityKind = "tool_use" | "tool_result" | "thinking" | "task_list" | "file_list";
export type Resolution = "approved" | "dismissed" | "feedback";
export type ResultStatus = "success" | "error";

/**
 * Client-side enriched activity: a tool_use with its tool_result merged in.
 * Created by the reducer so that each tool call is a single entry with
 * both input and result data, matching the shape:
 *   { toolType, input, result }
 */
export interface MergedActivity extends ActivityMessage {
  /** Result detail text from the paired tool_result */
  mergedResultDetail?: string;
  /** Result status from the paired tool_result */
  mergedResultStatus?: ResultStatus;
}

// ── ChatItem variants (source data from use-instance-messages) ──────

export interface UserChatItem {
  kind: "user";
  text: string;
  timestamp?: number;
  queued?: boolean;
  renderMode?: LargeUserRenderMode;
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

export interface CompactBoundaryChatItem {
  kind: "compact-boundary";
  timestamp?: number;
}

export interface ModelSwitchChatItem {
  kind: "model-switch";
  fromModel?: string;
  toModel?: string;
  fromModelLabel?: string;
  toModelLabel?: string;
  timestamp?: number;
}

export interface ThinkingBlockChatItem {
  kind: "thinking-block";
  text: string;
}

export interface ActivityGroupChatItem {
  kind: "activity-group";
  activities: MergedActivity[];
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
  | CompactBoundaryChatItem
  | ModelSwitchChatItem
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
  renderMode?: LargeUserRenderMode;
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

export interface CompactBoundaryRow {
  id: string;
  kind: "compact-boundary";
  timestamp?: number;
}

export interface ModelSwitchRow {
  id: string;
  kind: "model-switch";
  fromModel?: string;
  toModel?: string;
  fromModelLabel?: string;
  toModelLabel?: string;
  timestamp?: number;
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
  activities: MergedActivity[];
  originalIndex: number;
  isLastActivityGroup: boolean;
  trailingResolution?: Resolution;
  skipLeadingResult?: boolean;
}

export interface ToolContainerRow {
  id: string;
  kind: "tool-container";
  groups: ToolGroupData[];
  allActivities: MergedActivity[];
}

export type RenderRow =
  | UserRow
  | AssistantRow
  | SystemRow
  | CompactBoundaryRow
  | ModelSwitchRow
  | ThinkingBlockRow
  | AgentTranscriptRow
  | ResponseDividerRow
  | ToolContainerRow;

// ── Live activity (for status strip) ────────────────────────────────

export type LiveActivityPhase =
  | "starting"
  | "thinking"
  | "responding"
  | "task_list"
  | "file_list"
  | "tool";

export interface LiveActivity {
  /** Structured phase so the strip can decide between generic and detailed text. */
  phase: LiveActivityPhase;
  /** Whether the strip should show the detailed label or fall back to generic copy. */
  presentation: "generic" | "detailed";
  /** Human-readable description of what's happening */
  description: string;
  /** Tool name if applicable */
  tool?: string;
  /** When this specific activity started */
  startedAt: number;
}
