/**
 * Relay — Core Library
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
  DEFAULT_PROVIDER_CAPABILITIES,
  PROVIDER_DISPLAY_NAMES,
  getDefaultProviderCapabilities,
  findProviderModelLabel,
  getBuiltinProviderModels,
  getProviderDisplayName,
} from "./provider-catalog.js";
export {
  getProviderCapabilities,
  getProviderDriver,
  getRegisteredProviders,
  isProviderAvailable,
  listAvailableProviders,
} from "./provider-registry.js";
export { buildProviderSwitchHandoffPrompt } from "./session-handoff.js";

export { ClaudeProcess } from "./claude-process.js";
export type { ClaudeProcessEvents } from "./claude-process.js";

export { InstanceManager } from "./instance-manager.js";
export type { InstanceManagerEvents } from "./instance-manager.js";

export { SpaceManager } from "./space-manager.js";

export { TerminalManager } from "./terminal-manager.js";
export type { TerminalManagerEvents } from "./terminal-manager.js";

export type { PtyProcess, PtyAdapterFactory, PtySpawnOptions } from "./pty-adapter.js";
export { BasePtyProcess } from "./pty-adapter.js";
export { createNodePtyFactory } from "./pty-adapters/node-pty.js";

export type { CoreConfig, CoreOptions } from "./config.js";
export { resolveCoreConfig } from "./config.js";

export type { Logger } from "./logger.js";
export { defaultLogger, noopLogger } from "./logger.js";

export { SessionDB } from "./db.js";
export type { SessionRow, ProjectRow } from "./db.js";

export { ProjectManager } from "./project-manager.js";
export type { ProjectManagerEvents } from "./project-manager.js";

export {
  describeToolUse,
  describeToolDetail,
  extractToolResultText,
  isPermissionDenial,
  INTERACTIVE_TOOLS,
  classifyInteractiveResult,
  buildToolResultActivity,
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
  getFullDiff,
  getFileDiff,
  getDefaultBranch,
  getBranchDiff,
  getWorktreeDiff,
} from "./git.js";

export { discoverSkills } from "./skills.js";
export {
  exportRelayData,
  exportRelayArchive,
  importRelayData,
  importRelayArchive,
  createMigrationConfigFromCore,
  countJsonlFiles,
} from "./migration.js";
export type {
  MigrationConfig,
  RelayArchiveExportSummary,
  RelayExportManifest,
  RelayExportSummary,
  RelayImportSummary,
} from "./migration.js";

export type {
  SpaceStatus,
  SpaceInfo,
  MergeMethod,
  SkillInfo,
  SessionStats,
  ProviderKind,
  ProviderRequest,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderModelsResponse,
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
  SetPlanModePayload,
  CreateSpacePayload,
  CompleteSpacePayload,
  DeleteSpacePayload,
  Project,
  SpaceCreatedMessage,
  SpaceCompletedMessage,
  SpaceRemovedMessage,
  SpaceListMessage,
  ProjectsChangedMessage,
  TerminalInfo,
  TerminalScope,
  TerminalCreatePayload,
  TerminalInputPayload,
  TerminalResizePayload,
  TerminalClosePayload,
  TerminalSubscribePayload,
  TerminalUnsubscribePayload,
  TerminalListPayload,
  TerminalCreatedMessage,
  TerminalOutputMessage,
  TerminalExitMessage,
  TerminalRemovedMessage,
  TerminalScrollbackMessage,
  TerminalListResponse,
  ProjectPlan,
  ProjectStats,
  ModelUsageStats,
  ProjectArtifacts,
  Task,
  TaskStatus,
  TaskType,
  TasksChangedMessage,
} from "./types.js";

export {
  loadTasks,
  createTask,
  updateTask,
  deleteTask,
  hasTasks,
  initTasks,
} from "./task-manager.js";
