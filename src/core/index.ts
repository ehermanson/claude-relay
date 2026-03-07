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
export { defaultLogger, noopLogger } from "./logger.js";

export { SessionDB } from "./db.js";
export type { SessionRow } from "./db.js";

export {
  describeToolUse,
  describeToolDetail,
  extractToolResultText,
  isPermissionDenial,
  INTERACTIVE_TOOLS,
  classifyInteractiveResult,
  buildToolResultActivity,
  estimateCost,
} from "./tools.js";

export {
  isGitRepo,
  getRepoRoot,
  getCurrentBranch,
  createWorktree,
  removeWorktree,
  isRelayWorktreePath,
  resolveWorktreeOrigin,
  enrichDiffStats,
} from "./git.js";

export type {
  SessionStats,
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
  TaskItem,
  FileChange,
  TeamMember,
  TeamInfo,
  ProjectPlan,
  ProjectStats,
  ProjectArtifacts,
} from "./types.js";
