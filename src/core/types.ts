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
export type ProviderKind = "claude" | "codex" | "gemini";
export type ProviderRuntimeMode = "approval-required" | "full-access";

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
  costUSD: number;
  /** Model identifier from the most recent API response (e.g. "claude-opus-4-6") */
  model?: string;
  /**
   * Total input tokens from the most recent API call (input + cache_read + cache_creation).
   * Represents current context window utilization — NOT a cumulative sum.
   */
  contextTokens?: number;
  /** Provider-reported context window size when available. */
  contextWindow?: number;
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
  /** Whether this instance bypasses permission prompts (full access mode) */
  skipPermissions?: boolean;
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

export interface RefreshTitlePayload {
  type: "refresh_title";
  instanceId: string;
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

export interface SetProviderPayload {
  type: "set_provider";
  instanceId: string;
  /** Target provider to switch to */
  provider: ProviderKind;
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
  | RefreshTitlePayload
  | RenameInstancePayload
  | MergeInstancePayload
  | SetModelPayload
  | SetReasoningBudgetPayload
  | SetPermissionsPayload
  | SetProviderPayload;

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
  images?: string[];
  instanceId?: string;
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

export interface TeamMember {
  name: string;
  subagentType: string;
  description: string;
  status: "running" | "shutting_down" | "shutdown";
  spawnedAt: number;
}

export interface TeamInfo {
  name: string;
  description?: string;
  members: TeamMember[];
}

export interface AgentActivity {
  agentId: string;
  /** Latest activity description (e.g. "Reading auth.ts") */
  description?: string;
  /** Latest tool name */
  tool?: string;
  /** Latest output text (truncated) */
  lastOutput?: string;
  /** Timestamp of last progress event */
  updatedAt: number;
}

export interface ActivityMessage {
  type: "activity";
  activity:
    | "tool_use"
    | "tool_result"
    | "thinking"
    | "task_list"
    | "file_list"
    | "team_info"
    | "agent_activity";
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
  team?: TeamInfo;
  agentActivities?: AgentActivity[];
  inputDescription?: string;
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
  | InstanceHistoryMessage
  | TranscriptMessage;

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
  costUSD: number;
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
    costUSD: number;
  };
  allTime: {
    sessionCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    tokens: number;
    costUSD: number;
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

export interface McpServerConfig {
  type: string;
  url?: string;
  command?: string;
  args?: string[];
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
  /** GitHub repository URL for this project (from ~/.claude.json) */
  githubUrl: string | null;
  /** MCP server configurations for this project (from ~/.claude.json) */
  mcpServers: Record<string, McpServerConfig> | null;
  /** Open issues from beads (bd) issue tracker, if present in the project */
  beadsIssues: BeadIssue[] | null;
}
