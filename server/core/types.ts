/**
 * Shared type definitions for Relay
 *
 * Pure type definitions with zero runtime imports.
 * Used by both server code and the React UI.
 */

// =============================================================================
// Terminal Types
// =============================================================================

export type TerminalScope =
  | { type: "space"; spaceId: string }
  | { type: "instance"; instanceId: string };

export interface TerminalInfo {
  id: string;
  scope: TerminalScope;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
  exited: boolean;
  exitCode?: number;
}

// =============================================================================
// Space Types
// =============================================================================

export type SpaceStatus = "active" | "broken" | "completed" | "archived";
export type MergeMethod = "squash" | "merge-commit" | "external";

export interface SpaceInfo {
  id: string;
  projectDirectory: string;
  name: string;
  gitBranch: string | null;
  worktreePath: string | null;
  missingWorktreePath?: string | null;
  isDefault: boolean;
  status: SpaceStatus;
  createdAt: number;
  lastActivityAt: number;
  chatCount: number;
  mergeCommit?: string | null;
  mergeMethod?: MergeMethod | null;
  mergedAt?: number | null;
  targetBranch?: string | null;
  remoteStatus?: string | null;
  prUrl?: string | null;
}

// =============================================================================
// Instance Types
// =============================================================================

export type InstanceStatus = "idle" | "processing" | "error" | "stopped";
export type ProviderKind = "claude" | "codex" | "gemini";
export type ProviderRuntimeMode = "approval-required" | "full-access" | "plan";

/**
 * Canonical cross-provider reasoning effort level.
 * `max` is the Relay-canonical way to request the highest available effort.
 * Provider-native values (e.g. Codex `xhigh`) may appear via passthrough/restore.
 */
export type ReasoningEffort = "low" | "medium" | "high" | "max" | (string & {});

/**
 * Canonical provider-agnostic model options.
 * Provider drivers map these to provider-specific session args.
 */
export interface ProviderModelOptions {
  reasoningBudgetTokens?: number;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
}

export interface UserInputOption {
  label: string;
  description: string;
}

export interface UserInputQuestion {
  id: string;
  header: string;
  question: string;
  options?: UserInputOption[] | null;
  isOther?: boolean;
  isSecret?: boolean;
}

export interface UserInputAnswer {
  answers: string[];
}

export interface ProviderRequest {
  requestId: string;
  kind: "approval" | "user_input";
  tool?: string;
  description?: string;
  questions?: UserInputQuestion[];
}

export interface ProviderRequestResponse {
  answers?: Record<string, UserInputAnswer>;
}

export interface ProviderRuntimeBinding {
  provider: ProviderKind;
  providerSessionId?: string;
  resumeCursor?: unknown;
  runtimePayload?: Record<string, unknown>;
  transcriptPath?: string;
  runtimeMode?: ProviderRuntimeMode;
}

export interface ControlOption {
  label: string;
  description: string;
}

export interface ProviderCapabilities {
  supportsResume: boolean;
  supportsTranscriptReplay: boolean;
  supportsApprovals: boolean;
  supportsUserInputRequests: boolean;
  supportsReasoningBudget: boolean;
  supportsReasoningEffort: boolean;
  supportsFastMode: boolean;
  supportsPlanMode: boolean;
  supportsModelSelection: boolean;
  supportsTitleUpdates: boolean;
  /** Labels/descriptions for reasoning budget levels, rendered by the UI as-is */
  reasoningBudgetLevels?: { budget: number; label: string; description: string }[];
  /** Labels/descriptions for reasoning effort levels, rendered by the UI as-is */
  reasoningEffortLevels?: { effort: ReasoningEffort; label: string; description: string }[];
  /** Labels/descriptions for the permission mode toggle */
  permissionModes?: { restricted: ControlOption; fullAccess: ControlOption };
  /** Labels/descriptions for the plan mode toggle */
  planModes?: { off: ControlOption; on: ControlOption };
  /** Labels/descriptions for the fast mode toggle */
  fastModes?: { off: ControlOption; on: ControlOption };
}

export interface ProviderDescriptor {
  provider: ProviderKind;
  label: string;
  capabilities: ProviderCapabilities;
}

export interface ProviderModelOption {
  provider: ProviderKind;
  id: string;
  label: string;
  description?: string;
  hidden?: boolean;
  isDefault?: boolean;
  availabilityNote?: string;
  upgradeTo?: string;
}

export interface ProviderModelsResponse {
  provider: ProviderKind;
  models: ProviderModelOption[];
  capabilities: ProviderCapabilities;
}

export interface ProviderDefaults {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  reasoningBudget?: number;
  runtimeMode?: ProviderRuntimeMode;
  fastMode?: boolean;
}

export interface GlobalSettings {
  theme: "dark" | "light" | "system";
  defaultOpenTarget: string | null;
  defaultProvider: string | null;
  defaultModel: string | null;
  defaultSpaceBranch: string | null;
  spaceBranchSource: "local" | "remote";
  providerDefaults: Record<string, ProviderDefaults>;
  customInstructions: string | null;
}

export interface SessionStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Model identifier from the most recent API response (e.g. "claude-opus-4-6") */
  model?: string;
  /**
   * Most recent context footprint reported by the provider for the current thread/request.
   * Represents current context window utilization — NOT a cumulative session total.
   * When available, this should include cached input that still occupies context.
   */
  contextTokens?: number;
  /** Provider-reported context window size when available. */
  contextWindow?: number;
  /** Reasoning/thinking output tokens (Codex/OpenAI models). */
  reasoningTokens?: number;
}

export interface LastMessagePreview {
  text: string;
  from: "user" | "assistant";
  timestamp: number;
}

export interface InstanceInfo {
  id: string;
  provider: ProviderKind;
  name: string;
  workingDirectory: string;
  status: InstanceStatus;
  createdAt: number;
  lastActivityAt: number;
  external?: boolean;
  lastMessage?: LastMessagePreview;
  /** Tool name when an external/terminal session has a pending tool_use awaiting approval */
  pendingTool?: string;
  /** Pending managed-provider request awaiting user action */
  pendingPermission?: ProviderRequest;
  sessionId?: string;
  /** True when the user has manually set the title (prevents auto-refresh) */
  customTitle?: boolean;
  /** Running token/cost stats for this session */
  stats?: SessionStats;
  /** Git branch name when instance runs in a worktree (e.g. "relay/a1b2c3d4") */
  gitBranch?: string;
  /** True when the worktree has uncommitted changes or commits ahead of the original branch */
  hasChanges?: boolean;
  /** Original project directory before worktree substitution */
  originalDirectory?: string;
  /** Git metadata for the working directory (directory-level, independent of worktrees) */
  gitInfo?: { branch: string; isWorktree: boolean };
  /** Git branch at session creation time — used to detect mid-chat branch switches */
  originalGitBranch?: string;
  /** Set when the current branch differs from the branch this chat started on */
  branchChanged?: { originalBranch: string; currentBranch: string };
  /** Claude session ID of the plan-mode parent (UI-only link, no state merging) */
  parentSessionId?: string;
  /** Preferred model override for this instance (e.g. "claude-opus-4-6") */
  preferredModel?: string;
  /** Budget tokens for extended thinking, or null to use default */
  reasoningBudget?: number;
  /** Canonical provider-agnostic model options */
  modelOptions?: ProviderModelOptions;
  /** Whether provider plan mode is active for this instance */
  planMode?: boolean;
  /** Whether this instance bypasses permission prompts (full access mode) */
  skipPermissions?: boolean;
  /** Pending plan markdown from ExitPlanMode, awaiting user approval/feedback */
  pendingPlan?: string;
  /** Latest plan document content for sidecar display (persists after approval) */
  planContent?: string;
  /** Project ID this instance belongs to */
  projectId?: string;
  /** Space this instance belongs to (null = implicit main space) */
  spaceId?: string;
  /** Number of user messages queued while the agent is processing */
  queuedMessageCount?: number;
}

export interface HistoryEntry {
  timestamp: number;
  message: ServerMessage;
  /** Raw SDK/provider message object for debug display. */
  raw?: unknown;
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
  provider?: ProviderKind;
  name?: string;
  workingDirectory?: string;
  dangerouslySkipPermissions?: boolean;
  /** Resume an existing Claude Code session by ID */
  resumeSessionId?: string;
  /** Model ID to use (e.g. "claude-opus-4-6") */
  model?: string;
  /** Space to create this instance in */
  spaceId?: string;
  /** Canonical model options (reasoning budget, effort, fast mode) */
  modelOptions?: ProviderModelOptions;
  /** Whether to start in plan mode */
  planMode?: boolean;
}

export interface RemoveInstancePayload {
  type: "remove_instance";
  instanceId: string;
}

export interface PurgeInstancePayload {
  type: "purge_instance";
  instanceId: string;
}

export interface SubscribePayload {
  type: "subscribe";
  instanceId: string;
  lastSeenSequence?: number;
  replayEpoch?: number;
}

export interface UnsubscribePayload {
  type: "unsubscribe";
  instanceId: string;
}

export interface InstanceMessagePayload {
  type: "instance_message";
  instanceId: string;
  text: string;
  images?: string[];
  internal?: boolean;
}

export interface InstanceCancelPayload {
  type: "instance_cancel";
  instanceId: string;
}

export interface InstanceInterruptAndSendPayload {
  type: "instance_interrupt_and_send";
  instanceId: string;
}

export interface RespondToRequestPayload {
  type: "respond_to_request";
  instanceId: string;
  requestId: string;
  decision: "accept" | "decline";
  answers?: Record<string, UserInputAnswer>;
}

export interface RenameInstancePayload {
  type: "rename_instance";
  instanceId: string;
  name: string;
}

export interface RenameSpacePayload {
  type: "rename_space";
  spaceId: string;
  name: string;
}

export interface MergeInstancePayload {
  type: "merge_instance";
  instanceId: string;
}

export interface SetModelPayload {
  type: "set_model";
  instanceId: string;
  /** Model ID to use (e.g. "claude-opus-4-6"), or null to clear the preference */
  model: string | null;
}

export interface SetPermissionsPayload {
  type: "set_permissions";
  instanceId: string;
  /** Whether to skip all permission prompts (full access mode) */
  skipPermissions: boolean;
}

export interface SetPlanModePayload {
  type: "set_plan_mode";
  instanceId: string;
  /** Whether provider plan mode should be active */
  planMode: boolean;
}

export interface SetModelOptionsPayload {
  type: "set_model_options";
  instanceId: string;
  /** Sparse merge: omitted key = leave unchanged, null = clear/reset to default */
  modelOptions: {
    reasoningBudgetTokens?: number | null;
    reasoningEffort?: ReasoningEffort | null;
    fastMode?: boolean | null;
  };
}

export interface SetProviderPayload {
  type: "set_provider";
  instanceId: string;
  /** Target provider to switch to */
  provider: ProviderKind;
}

export interface CreateSpacePayload {
  type: "create_space";
  projectDirectory: string;
  name?: string;
  baseBranch?: string;
}

export interface CompleteSpacePayload {
  type: "complete_space";
  spaceId: string;
  mergeMethod?: MergeMethod;
  squashMessage?: string;
}

export interface MarkSpaceMergedPayload {
  type: "mark_space_merged";
  spaceId: string;
}

export interface DeleteSpacePayload {
  type: "delete_space";
  spaceId: string;
}

// ── Terminal client messages ──────────────────────────────────────────

export interface TerminalCreatePayload {
  type: "terminal_create";
  scope: TerminalScope;
  cwd?: string;
  cols?: number;
  rows?: number;
  /** When true, the server will only create a terminal if none exist for this scope. */
  ifEmpty?: boolean;
}

export interface TerminalInputPayload {
  type: "terminal_input";
  terminalId: string;
  data: string;
}

export interface TerminalResizePayload {
  type: "terminal_resize";
  terminalId: string;
  cols: number;
  rows: number;
}

export interface TerminalClosePayload {
  type: "terminal_close";
  terminalId: string;
}

export interface TerminalSubscribePayload {
  type: "terminal_subscribe";
  terminalId: string;
}

export interface TerminalUnsubscribePayload {
  type: "terminal_unsubscribe";
  terminalId: string;
}

export interface TerminalListPayload {
  type: "terminal_list";
  scope: TerminalScope;
}

export type ClientMessage =
  | MessagePayload
  | CancelPayload
  | ListInstancesPayload
  | CreateInstancePayload
  | RemoveInstancePayload
  | PurgeInstancePayload
  | SubscribePayload
  | UnsubscribePayload
  | InstanceMessagePayload
  | InstanceCancelPayload
  | InstanceInterruptAndSendPayload
  | RespondToRequestPayload
  | RenameInstancePayload
  | RenameSpacePayload
  | MergeInstancePayload
  | SetModelPayload
  | SetPermissionsPayload
  | SetPlanModePayload
  | SetModelOptionsPayload
  | SetProviderPayload
  | CreateSpacePayload
  | CompleteSpacePayload
  | MarkSpaceMergedPayload
  | DeleteSpacePayload
  | TerminalCreatePayload
  | TerminalInputPayload
  | TerminalResizePayload
  | TerminalClosePayload
  | TerminalSubscribePayload
  | TerminalUnsubscribePayload
  | TerminalListPayload;

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
  eventSequence?: number;
  /** Raw SDK/provider message for debug display. */
  raw?: unknown;
}

export interface UserMessage {
  type: "user";
  text: string;
  images?: string[];
  instanceId?: string;
  eventSequence?: number;
  /** If true, this message was injected programmatically (e.g. auto-continue after restart) and should be hidden from the chat UI. */
  internal?: boolean;
  /** True when this message was queued while the agent was processing and hasn't been delivered yet. */
  queued?: boolean;
}

export interface ExitMessage {
  type: "exit";
  code: number;
  signal?: string;
  stderr?: string;
  instanceId?: string;
  eventSequence?: number;
}

export interface ErrorMessage {
  type: "error";
  message: string;
  instanceId?: string;
}

export interface NotificationMessage {
  type: "notification";
  message: string;
  instanceId?: string;
}

export interface TaskItem {
  id: string;
  subject: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export interface FileChange {
  path: string;
  editCount: number;
  /** "added" when first operation was Write, "edited" for Edit/NotebookEdit */
  type: "added" | "edited";
  /** Lines added (from git diff --numstat) */
  additions?: number;
  /** Lines deleted (from git diff --numstat) */
  deletions?: number;
}

export interface ActivityMessage {
  type: "activity";
  activity: "tool_use" | "tool_result" | "thinking" | "task_list" | "file_list";
  tool?: string;
  description: string;
  detail?: string;
  input?: Record<string, unknown>;
  instanceId?: string;
  eventSequence?: number;
  permissionDenied?: string;
  /** Resolution of an interactive tool (ExitPlanMode, AskUserQuestion) from the terminal. */
  resolution?: "approved" | "dismissed" | "feedback";
  tasks?: TaskItem[];
  files?: FileChange[];
  inputDescription?: string;
  /** Raw SDK/provider message for debug display. */
  raw?: unknown;
}

export interface InstanceListMessage {
  type: "instance_list";
  instances: InstanceInfo[];
}

export interface InstanceCreatedMessage {
  type: "instance_created";
  instanceId: string;
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
  replayMode?: "full" | "delta";
  latestSequence?: number;
  replayEpoch?: number;
}

export interface TranscriptMessage {
  type: "transcript";
  title: string;
  result: string;
  instanceId?: string;
  eventSequence?: number;
}

export interface ScanCompleteMessage {
  type: "scan_complete";
}

export interface ProjectsChangedMessage {
  type: "projects_changed";
  projects: Project[];
}

export interface TasksChangedMessage {
  type: "tasks_changed";
  projectId: string;
  tasks: Task[];
}

export interface SpaceCreatedMessage {
  type: "space_created";
  space: SpaceInfo;
}

export interface SpaceCompletedMessage {
  type: "space_completed";
  spaceId: string;
  targetBranch: string;
  mergeMethod?: string;
  mergeCommit?: string;
}

export interface SpaceRemovedMessage {
  type: "space_removed";
  spaceId: string;
}

export interface SpaceListMessage {
  type: "space_list";
  projectDirectory: string;
  spaces: SpaceInfo[];
}

// ── Terminal server messages ──────────────────────────────────────────

export interface TerminalCreatedMessage {
  type: "terminal_created";
  terminal: TerminalInfo;
}

export interface TerminalOutputMessage {
  type: "terminal_output";
  terminalId: string;
  data: string;
}

export interface TerminalExitMessage {
  type: "terminal_exit";
  terminalId: string;
  code: number;
  signal?: string;
}

export interface TerminalRemovedMessage {
  type: "terminal_removed";
  terminalId: string;
}

export interface TerminalScrollbackMessage {
  type: "terminal_scrollback";
  terminalId: string;
  data: string;
}

export interface TerminalListResponse {
  type: "terminal_list_response";
  scope: TerminalScope;
  terminals: TerminalInfo[];
}

export interface HeartbeatMessage {
  type: "heartbeat";
}

export type ServerMessage =
  | ConnectedMessage
  | OutputMessage
  | UserMessage
  | ExitMessage
  | ErrorMessage
  | NotificationMessage
  | ActivityMessage
  | InstanceListMessage
  | InstanceCreatedMessage
  | InstanceRemovedMessage
  | InstanceStatusMessage
  | InstanceHistoryMessage
  | TranscriptMessage
  | ScanCompleteMessage
  | ProjectsChangedMessage
  | TasksChangedMessage
  | SpaceCreatedMessage
  | SpaceCompletedMessage
  | SpaceRemovedMessage
  | SpaceListMessage
  | TerminalCreatedMessage
  | TerminalOutputMessage
  | TerminalExitMessage
  | TerminalRemovedMessage
  | TerminalScrollbackMessage
  | TerminalListResponse
  | HeartbeatMessage;

// =============================================================================
// Session Types
// =============================================================================

export interface Session {
  id: string;
  createdAt: number;
  expiresAt: number;
}

// =============================================================================
// Project Artifact Types
// =============================================================================

export interface Project {
  id: string;
  name: string;
  directory: string;
  repoRoot: string | null;
  remoteUrl: string | null;
  targetBranch: string | null;
  customInstructions: string | null;
  defaultSpaceBranch: string | null;
  spaceBranchSource: "local" | "remote" | null;
  defaultProvider: string | null;
  defaultModel: string | null;
  createdAt: number;
  lastActivityAt: number | null;
}

export interface ProjectPlan {
  slug: string;
  title: string;
  modifiedAt: number;
  content: string;
}

export interface ModelUsageStats {
  model: string;
  providerName: string;
  sessionCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface ProjectStats {
  sessionCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  modelUsage: ModelUsageStats[];
}

export type NativeOpenTargetKind = "default" | "app" | "finder" | "file-manager" | "terminal";

export interface NativeOpenTarget {
  id: string;
  label: string;
  kind: NativeOpenTargetKind;
  description?: string;
}

export interface NativeOpenTargetsResponse {
  path: string;
  preferredTargetId: string | null;
  targets: NativeOpenTarget[];
}

export interface NativeOpenRequest {
  path: string;
  line?: number;
  column?: number;
  targetId?: string;
  rememberForProject?: boolean;
}

export type TaskStatus = "open" | "in_progress" | "blocked" | "done";
export type TaskType = "epic" | "task" | "bug";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  type: TaskType;
  tags: string[];
  parent: string | null;
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
  /** Tombstone flag for append-only deletion */
  deleted?: boolean;
}

export interface SkillInfo {
  /** Skill name from SKILL.md frontmatter (or directory name fallback) */
  name: string;
  /** Description / trigger text from SKILL.md frontmatter */
  description: string;
  /** Where the skill was discovered (highest-priority location wins) */
  source: "project" | "user" | "system";
  /** Absolute path to the skill directory (highest-priority location) */
  path: string;
  /** Which providers can use this skill (based on which directories it was found in) */
  providers: ProviderKind[];
}

export interface ProjectArtifacts {
  projectId: string;
  directory: string;
  memory: string | null;
  /** Contents of CLAUDE.md from the project root */
  claudeMd: string | null;
  /** Contents of README.md from the project root (last-resort fallback) */
  readmeMd: string | null;
  plans: ProjectPlan[];
  /** Aggregated token/cost stats across all sessions in this project */
  stats: ProjectStats;
  /** GitHub/GitLab repository URL for this project (from git remote) */
  githubUrl: string | null;
  /** Tasks from .relay/tasks.jsonl, if present in the project */
  tasks: Task[] | null;
  /** Installed skills discovered from .claude/skills/, ~/.claude/skills/, etc. */
  skills: SkillInfo[];
  /** Spaces in this project */
  spaces: SpaceInfo[];
}
