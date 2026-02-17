/**
 * Shared type definitions for Claude Relay
 *
 * Pure type definitions with zero runtime imports.
 * Used by both server code and the React UI.
 */

// =============================================================================
// Instance Types
// =============================================================================

export type InstanceStatus = "idle" | "processing" | "error" | "stopped";

export interface LastMessagePreview {
  text: string;
  from: "user" | "claude";
  timestamp: number;
}

export interface InstanceInfo {
  id: string;
  name: string;
  workingDirectory: string;
  status: InstanceStatus;
  createdAt: number;
  lastActivityAt: number;
  external?: boolean;
  lastMessage?: LastMessagePreview;
  waitingForInput?: boolean;
}

export interface HistoryEntry {
  timestamp: number;
  message: ServerMessage;
}

// =============================================================================
// Client -> Server Messages
// =============================================================================

export interface MessagePayload {
  type: "message";
  text: string;
}

export interface CancelPayload {
  type: "cancel";
}

export interface ListInstancesPayload {
  type: "list_instances";
}

export interface CreateInstancePayload {
  type: "create_instance";
  name?: string;
  workingDirectory?: string;
  dangerouslySkipPermissions?: boolean;
}

export interface RemoveInstancePayload {
  type: "remove_instance";
  instanceId: string;
}

export interface SubscribePayload {
  type: "subscribe";
  instanceId: string;
}

export interface UnsubscribePayload {
  type: "unsubscribe";
  instanceId: string;
}

export interface InstanceMessagePayload {
  type: "instance_message";
  instanceId: string;
  text: string;
}

export interface InstanceCancelPayload {
  type: "instance_cancel";
  instanceId: string;
}

export interface ResumeInstancePayload {
  type: "resume_instance";
  instanceId: string;
}

export interface ApproveToolPayload {
  type: "approve_tool";
  instanceId: string;
  tool: string;
}

export type ClientMessage =
  | MessagePayload
  | CancelPayload
  | ListInstancesPayload
  | CreateInstancePayload
  | RemoveInstancePayload
  | SubscribePayload
  | UnsubscribePayload
  | InstanceMessagePayload
  | InstanceCancelPayload
  | ResumeInstancePayload
  | ApproveToolPayload;

// =============================================================================
// Server -> Client Messages
// =============================================================================

export interface ConnectedMessage {
  type: "connected";
}

export interface OutputMessage {
  type: "output";
  text: string;
  isWaiting: boolean;
  thinking?: string;
  instanceId?: string;
}

export interface UserMessage {
  type: "user";
  text: string;
  instanceId?: string;
}

export interface ExitMessage {
  type: "exit";
  code: number;
  instanceId?: string;
}

export interface ErrorMessage {
  type: "error";
  message: string;
  instanceId?: string;
}

export interface ActivityMessage {
  type: "activity";
  activity: "tool_use" | "tool_result" | "thinking";
  tool?: string;
  description: string;
  detail?: string;
  input?: Record<string, unknown>;
  instanceId?: string;
  permissionDenied?: string;
}

export interface InstanceListMessage {
  type: "instance_list";
  instances: InstanceInfo[];
}

export interface InstanceCreatedMessage {
  type: "instance_created";
  instance: InstanceInfo;
}

export interface InstanceRemovedMessage {
  type: "instance_removed";
  instanceId: string;
}

export interface InstanceStatusMessage {
  type: "instance_status";
  instanceId: string;
  instance: InstanceInfo;
}

export interface InstanceHistoryMessage {
  type: "instance_history";
  instanceId: string;
  history: HistoryEntry[];
}

export type ServerMessage =
  | ConnectedMessage
  | OutputMessage
  | UserMessage
  | ExitMessage
  | ErrorMessage
  | ActivityMessage
  | InstanceListMessage
  | InstanceCreatedMessage
  | InstanceRemovedMessage
  | InstanceStatusMessage
  | InstanceHistoryMessage;

// =============================================================================
// Session Types
// =============================================================================

export interface Session {
  id: string;
  createdAt: number;
  expiresAt: number;
}
