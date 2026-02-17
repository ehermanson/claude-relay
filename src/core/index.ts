/**
 * Claude Relay — Core Library
 *
 * Process management, instance orchestration, and types.
 * No server dependencies (HTTP, WebSocket, auth).
 *
 * @example
 * ```ts
 * import { InstanceManager, resolveCoreConfig } from "claude-relay";
 *
 * const config = resolveCoreConfig({ workingDirectory: "/my/project" });
 * const manager = new InstanceManager(config);
 * const instance = manager.createInstance({ name: "My Session" });
 * ```
 */

export { ClaudeProcess } from "./claude-process.js";
export type { ClaudeProcessEvents } from "./claude-process.js";

export { InstanceManager } from "./instance-manager.js";
export type { InstanceManagerEvents } from "./instance-manager.js";

export type { CoreConfig, CoreOptions } from "./config.js";
export { resolveCoreConfig } from "./config.js";

export type { Logger } from "./logger.js";
export { noopLogger } from "./logger.js";

export { describeToolUse, describeToolDetail, isPermissionDenial } from "./tools.js";

export type {
  InstanceStatus,
  LastMessagePreview,
  InstanceInfo,
  HistoryEntry,
  MessagePayload,
  CancelPayload,
  ListInstancesPayload,
  CreateInstancePayload,
  RemoveInstancePayload,
  SubscribePayload,
  UnsubscribePayload,
  InstanceMessagePayload,
  InstanceCancelPayload,
  ResumeInstancePayload,
  ApproveToolPayload,
  ClientMessage,
  ConnectedMessage,
  OutputMessage,
  UserMessage,
  ExitMessage,
  ErrorMessage,
  ActivityMessage,
  InstanceListMessage,
  InstanceCreatedMessage,
  InstanceRemovedMessage,
  InstanceStatusMessage,
  InstanceHistoryMessage,
  ServerMessage,
  Session,
} from "./types.js";
