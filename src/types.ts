/**
 * Shared TypeScript types for Claude Relay
 *
 * This module defines all message types for WebSocket communication
 * between the client and server, as well as session and configuration types.
 */

// =============================================================================
// Client -> Server Messages
// =============================================================================

/**
 * Message sent from client to Claude (legacy single-instance)
 */
export interface MessagePayload {
  type: "message";
  /** The text content to send to Claude */
  text: string;
}

/**
 * Request to cancel the current Claude operation (legacy single-instance)
 */
export interface CancelPayload {
  type: "cancel";
}

/**
 * Request the list of all instances
 */
export interface ListInstancesPayload {
  type: "list_instances";
}

/**
 * Create a new instance
 */
export interface CreateInstancePayload {
  type: "create_instance";
  name?: string;
  workingDirectory?: string;
  dangerouslySkipPermissions?: boolean;
}

/**
 * Remove an existing instance
 */
export interface RemoveInstancePayload {
  type: "remove_instance";
  instanceId: string;
}

/**
 * Subscribe to an instance's events
 */
export interface SubscribePayload {
  type: "subscribe";
  instanceId: string;
}

/**
 * Unsubscribe from an instance's events
 */
export interface UnsubscribePayload {
  type: "unsubscribe";
  instanceId: string;
}

/**
 * Send a message to a specific instance
 */
export interface InstanceMessagePayload {
  type: "instance_message";
  instanceId: string;
  text: string;
}

/**
 * Cancel operation on a specific instance
 */
export interface InstanceCancelPayload {
  type: "instance_cancel";
  instanceId: string;
}

/**
 * Resume an external session as a managed instance
 */
export interface ResumeInstancePayload {
  type: "resume_instance";
  instanceId: string;
}

/**
 * Union of all messages that can be sent from client to server
 */
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
  | ResumeInstancePayload;

// =============================================================================
// Server -> Client Messages
// =============================================================================

/**
 * Sent when WebSocket connection is established and authenticated
 */
export interface ConnectedMessage {
  type: "connected";
}

/**
 * Streaming output from Claude
 */
export interface OutputMessage {
  type: "output";
  /** The text content from Claude */
  text: string;
  /** Whether Claude is waiting for user input */
  isWaiting: boolean;
  /** Optional thinking/reasoning content from Claude */
  thinking?: string;
  /** Instance this output belongs to */
  instanceId?: string;
}

/**
 * Echo of the user's message for confirmation in the UI
 */
export interface UserMessage {
  type: "user";
  /** The text that was sent to Claude */
  text: string;
  /** Instance this message was sent to */
  instanceId?: string;
}

/**
 * Sent when the Claude process exits
 */
export interface ExitMessage {
  type: "exit";
  /** The exit code of the Claude process */
  code: number;
  /** Instance this exit belongs to */
  instanceId?: string;
}

/**
 * Sent when an error occurs
 */
export interface ErrorMessage {
  type: "error";
  /** Human-readable error description */
  message: string;
  /** Instance this error belongs to */
  instanceId?: string;
}

/**
 * Activity update showing what Claude is doing (tool use, thinking, etc.)
 */
export interface ActivityMessage {
  type: "activity";
  /** Type of activity: "tool_use", "tool_result", "thinking" */
  activity: "tool_use" | "tool_result" | "thinking";
  /** Name of the tool being used (for tool_use) */
  tool?: string;
  /** Brief description of the activity */
  description: string;
  /** Optional detailed content (file path, command, etc.) */
  detail?: string;
  /** Instance this activity belongs to */
  instanceId?: string;
}

// =============================================================================
// Instance-aware Server Messages
// =============================================================================

import type { InstanceInfo, HistoryEntry } from "./instance-manager.js";

/**
 * Full list of instances
 */
export interface InstanceListMessage {
  type: "instance_list";
  instances: InstanceInfo[];
}

/**
 * A new instance was created
 */
export interface InstanceCreatedMessage {
  type: "instance_created";
  instance: InstanceInfo;
}

/**
 * An instance was removed
 */
export interface InstanceRemovedMessage {
  type: "instance_removed";
  instanceId: string;
}

/**
 * An instance's status changed
 */
export interface InstanceStatusMessage {
  type: "instance_status";
  instanceId: string;
  instance: InstanceInfo;
}

/**
 * Conversation history for an instance (sent on subscribe)
 */
export interface InstanceHistoryMessage {
  type: "instance_history";
  instanceId: string;
  history: HistoryEntry[];
}

/**
 * Union of all messages that can be sent from server to client
 */
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

/**
 * Represents an authenticated user session
 */
export interface Session {
  /** Unique session identifier (256-bit random string) */
  id: string;
  /** Timestamp when the session was created (ms since epoch) */
  createdAt: number;
  /** Timestamp when the session expires (ms since epoch) */
  expiresAt: number;
}
