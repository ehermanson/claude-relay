/**
 * Shared type definitions for Relay
 *
 * Pure type definitions with zero runtime imports.
 * Used by both server code and the React UI.
 */

// =============================================================================
// Instance Types
// =============================================================================

export type InstanceStatus = "idle" | "processing" | "error" | "stopped";
export type ProviderKind = "claude" | "codex" | "gemini";
export type ProviderRuntimeMode = "approval-required" | "full-access" | "plan";

export interface ProviderRequest {
  requestId: string;
  kind: "approval";
  tool?: string;
  description?: string;
}

export interface ProviderRuntimeBinding {
  provider: ProviderKind;
  providerSessionId?: string;
  resumeCursor?: unknown;
  runtimePayload?: Record<string, unknown>;
  transcriptPath?: string;
  runtimeMode?: ProviderRuntimeMode;
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

export interface SessionStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Model identifier from the most recent API response (e.g. "claude-opus-4-6") */
  model?: string;
  /**
   * Total input tokens from the most recent API call (input + cache_read + cache_creation).
   * Represents current context window utilization — NOT a cumulative sum.
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
  /** Pending permission request for a managed instance awaiting user approval */
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
  /** Claude session ID of the plan-mode parent (UI-only link, no state merging) */
  parentSessionId?: string;
  /** Preferred model override for this instance (e.g. "claude-opus-4-6") */
  preferredModel?: string;
  /** Budget tokens for extended thinking, or null to use default */
  reasoningBudget?: number;
  /** Whether provider plan mode is active for this instance */
  planMode?: boolean;
  /** Whether this instance bypasses permission prompts (full access mode) */
  skipPermissions?: boolean;
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
  images?: string[];
}

export interface InstanceCancelPayload {
  type: "instance_cancel";
  instanceId: string;
}

export interface RespondToRequestPayload {
  type: "respond_to_request";
  instanceId: string;
  requestId: string;
  decision: "accept" | "decline";
}

export interface RenameInstancePayload {
  type: "rename_instance";
  instanceId: string;
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

export interface SetReasoningBudgetPayload {
  type: "set_reasoning_budget";
  instanceId: string;
  /** Budget tokens for extended thinking, or null to clear */
  budget: number | null;
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

export interface SetProviderPayload {
  type: "set_provider";
  instanceId: string;
  /** Target provider to switch to */
  provider: ProviderKind;
}

export interface HideDirectoryPayload {
  type: "hide_directory";
  path: string;
}

export interface UnhideDirectoryPayload {
  type: "unhide_directory";
  path: string;
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
  | RespondToRequestPayload
  | RenameInstancePayload
  | MergeInstancePayload
  | SetModelPayload
  | SetReasoningBudgetPayload
  | SetPermissionsPayload
  | SetPlanModePayload
  | SetProviderPayload
  | HideDirectoryPayload
  | UnhideDirectoryPayload;

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
  /** Raw SDK/provider message for debug display. */
  raw?: unknown;
}

export interface UserMessage {
  type: "user";
  text: string;
  images?: string[];
  instanceId?: string;
  /** If true, this message was injected programmatically (e.g. auto-continue after restart) and should be hidden from the chat UI. */
  internal?: boolean;
}

export interface ExitMessage {
  type: "exit";
  code: number;
  signal?: string;
  stderr?: string;
  instanceId?: string;
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

export interface TranscriptMessage {
  type: "transcript";
  title: string;
  result: string;
  instanceId?: string;
}

export interface ScanCompleteMessage {
  type: "scan_complete";
}

export interface HiddenDirectoriesMessage {
  type: "hidden_directories";
  directories: string[];
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
  | HiddenDirectoriesMessage;

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

export interface ProjectPlan {
  slug: string;
  title: string;
  modifiedAt: number;
  content: string;
}

export interface ProjectStats {
  sessionCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface DashboardStats {
  instances: {
    total: number;
    active: number;
    idle: number;
    stopped: number;
    external: number;
  };
  currentSessions: {
    tokens: number;
  };
  allTime: {
    sessionCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    tokens: number;
  };
  uptime: number;
  connections: number;
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

export interface BeadIssueDep {
  id: string;
  title: string;
  status: string;
}

export interface BeadIssue {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  issue_type: string;
  owner: string;
  created_at: string;
  updated_at: string;
  dependency_count: number;
  dependent_count: number;
  dependencies?: BeadIssueDep[];
  dependents?: BeadIssueDep[];
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
  /** Open issues from beads (bd) issue tracker, if present in the project */
  beadsIssues: BeadIssue[] | null;
  /** Installed skills discovered from .claude/skills/, ~/.claude/skills/, etc. */
  skills: SkillInfo[];
}
