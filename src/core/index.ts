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

export type { ProviderSession, ProviderSessionEvents } from "./provider.js";

export { createSdkSession, createSdkSessionSync, resolveQueryFn } from "./providers/index.js";
export type {
  ClaudeSdkSession,
  ClaudeSdkSessionOptions,
  CodexAppServerSessionOptions,
  DiscoverCodexModelsOptions,
} from "./providers/index.js";
export {
  CodexAppServerSession,
  discoverCodexModels,
  findCodexBinary,
  isCodexInstalled,
} from "./providers/index.js";
export {
  BUILTIN_PROVIDER_MODELS,
  PROVIDER_DISPLAY_NAMES,
  findProviderModelLabel,
  getBuiltinProviderModels,
  getProviderDisplayName,
} from "./provider-catalog.js";
export { buildProviderSwitchHandoffPrompt } from "./session-handoff.js";

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
  ProviderKind,
  ProviderRequest,
  ProviderRuntimeBinding,
  ProviderRuntimeMode,
  ProviderModelOption,
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
  RespondToRequestPayload,
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
