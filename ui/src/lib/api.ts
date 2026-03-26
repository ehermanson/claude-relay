import type {
  CreateInstancePayload,
  HistoryEntry,
  InstanceInfo,
  NativeOpenTargetsResponse,
  Project,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderKind,
  ProviderModelOption,
  ProjectArtifacts,
  SpaceInfo,
} from "@shared/types";
import { getDefaultProviderCapabilities } from "@shared/provider-catalog";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface HealthResponse {
  status: string;
  uptime: number;
  instances: number;
  version: string;
  authRequired: boolean;
  git: { branch: string; isWorktree: boolean } | null;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/health");
  if (!res.ok) throw new Error("Failed to fetch health");
  return res.json();
}

export async function login(password: string): Promise<{ success: boolean; error?: string }> {
  const res = await fetch("/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });

  if (res.ok) {
    return { success: true };
  }

  let error = "Authentication failed";
  try {
    const data = await res.json();
    if (data.error) error = data.error;
  } catch {
    // Use default
  }
  return { success: false, error };
}

export async function fetchDirectories(): Promise<{
  defaultDirectory: string;
  directories: { path: string; lastUsed: number }[];
}> {
  const res = await fetch("/api/directories");
  if (!res.ok) throw new Error("Failed to fetch directories");
  return res.json();
}

export async function fetchGitRepos(): Promise<string[]> {
  const res = await fetch("/api/git-repos");
  if (!res.ok) return [];
  const data = (await res.json()) as { repos?: string[] };
  return data.repos ?? [];
}

export async function browsePath(
  prefix: string,
  opts?: { gitOnly?: boolean },
): Promise<{ home: string; directories: string[]; gitRepos?: string[] }> {
  const params = new URLSearchParams({ prefix });
  if (opts?.gitOnly) params.set("gitOnly", "1");
  const res = await fetch("/api/browse?" + params.toString());
  if (!res.ok) return { home: "", directories: [] };
  return res.json();
}

export async function fetchWorkspaceEntries(
  instanceId: string,
  query: string,
): Promise<{ entries: Array<{ path: string; kind: "file" | "directory" }> }> {
  const res = await fetch(
    `/api/workspace-entries?instanceId=${encodeURIComponent(instanceId)}&q=${encodeURIComponent(query)}`,
  );
  if (!res.ok) return { entries: [] };
  return res.json();
}

export async function fetchProviderModels(
  provider: ProviderKind,
): Promise<{ models: ProviderModelOption[]; capabilities: ProviderCapabilities }> {
  const res = await fetch(`/api/provider-models?provider=${encodeURIComponent(provider)}`);
  if (!res.ok) throw new Error("Failed to fetch provider models");
  const data = (await res.json()) as {
    models?: ProviderModelOption[];
    capabilities?: ProviderCapabilities;
  };
  return {
    models: data.models ?? [],
    capabilities: data.capabilities ?? getDefaultProviderCapabilities(provider),
  };
}

export async function fetchProviders(): Promise<ProviderDescriptor[]> {
  const res = await fetch("/api/providers");
  if (!res.ok) throw new Error("Failed to fetch providers");
  const data = (await res.json()) as { providers?: ProviderDescriptor[] };
  return data.providers ?? [];
}

export async function createInstance(
  payload: Omit<CreateInstancePayload, "type">,
): Promise<InstanceInfo> {
  const res = await fetch("/api/instances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to create instance" }));
    throw new Error(data.error || "Failed to create instance");
  }

  return res.json();
}

export async function fetchInstanceHistory(instanceId: string): Promise<HistoryEntry[]> {
  const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/history`);
  if (!res.ok) throw new Error("Failed to fetch instance history");
  return res.json();
}

export async function fetchInstanceSummary(instanceId: string): Promise<InstanceInfo | null> {
  const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/summary`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Failed to fetch instance summary");
  return res.json();
}

export async function uploadImage(file: File): Promise<string> {
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(data.error || "Upload failed");
  }
  const data = await res.json();
  return data.path;
}

// ─── Task CRUD ────────────────────────────────────────────────────────────

interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: number;
  type?: import("@shared/types").TaskType;
  tags?: string[];
  parent?: string | null;
  blockedBy?: string[];
}

interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: import("@shared/types").TaskStatus;
  priority?: number;
  type?: import("@shared/types").TaskType;
  tags?: string[];
  parent?: string | null;
  blockedBy?: string[];
}

export async function fetchTasks(
  projectId: string,
): Promise<import("@shared/types").Task[] | null> {
  const res = await fetch(`/api/projects/${projectId}/tasks`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.tasks;
}

export async function createTaskApi(
  projectId: string,
  input: CreateTaskInput,
): Promise<import("@shared/types").Task> {
  const res = await fetch(`/api/projects/${projectId}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to create task" }));
    throw new Error(err.error);
  }
  return res.json();
}

export async function updateTaskApi(
  projectId: string,
  taskId: string,
  patch: UpdateTaskInput,
): Promise<import("@shared/types").Task> {
  const res = await fetch(`/api/projects/${projectId}/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to update task" }));
    throw new Error(err.error);
  }
  return res.json();
}

export async function deleteTaskApi(projectId: string, taskId: string): Promise<void> {
  const res = await fetch(`/api/projects/${projectId}/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to delete task" }));
    throw new Error(err.error);
  }
}

export async function initTasksApi(projectId: string): Promise<{ snippet: string }> {
  const res = await fetch(`/api/projects/${projectId}/tasks/init`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to initialize tasks");
  return res.json();
}

export async function fetchProjectIcons(): Promise<Record<string, string>> {
  const res = await fetch("/api/project-icons");
  if (!res.ok) return {};
  return res.json();
}

export async function fetchProject(projectId: string): Promise<Project> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
  if (!res.ok) throw new ApiError("Failed to fetch project", res.status);
  return res.json();
}

export async function fetchProjectArtifacts(projectId: string): Promise<ProjectArtifacts> {
  const res = await fetch(`/api/project-artifacts/${encodeURIComponent(projectId)}`);
  if (!res.ok) throw new ApiError("Failed to fetch project", res.status);
  return res.json();
}

export async function fetchProjectChats(projectId: string): Promise<InstanceInfo[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/chats`);
  if (!res.ok) return [];
  return res.json();
}

export async function openNativePath(target: {
  path: string;
  line?: number;
  column?: number;
  targetId?: string;
  rememberForProject?: boolean;
}): Promise<void> {
  const res = await fetch("/api/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(target),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to open path" }));
    throw new Error(data.error || "Failed to open path");
  }
}

export async function fetchOpenTargets(targetPath: string): Promise<NativeOpenTargetsResponse> {
  const res = await fetch(`/api/open-targets?path=${encodeURIComponent(targetPath)}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to fetch open targets" }));
    throw new Error(data.error || "Failed to fetch open targets");
  }
  return res.json();
}

export async function fetchInstanceDiff(instanceId: string, filePath?: string): Promise<string> {
  const params = new URLSearchParams();
  if (filePath) params.set("path", filePath);
  const qs = params.toString();
  const url = `/api/instances/${encodeURIComponent(instanceId)}/diff${qs ? `?${qs}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to fetch diff" }));
    throw new Error(data.error || "Failed to fetch diff");
  }
  const data = await res.json();
  return data.diff;
}

export async function gitPushInstance(
  instanceId: string,
  opts?: { branch?: string; setUpstream?: boolean },
): Promise<GitOpResult> {
  const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/git/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  });
  return res.json();
}

export async function gitCommitInstance(
  instanceId: string,
  opts?: { message?: string },
): Promise<GitOpResult> {
  const res = await fetch(`/api/instances/${encodeURIComponent(instanceId)}/git/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  });
  return res.json();
}

// =========================================================================
// Project CRUD
// =========================================================================

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch("/api/projects");
  if (!res.ok) return [];
  const data = (await res.json()) as { projects?: Project[] };
  return data.projects ?? [];
}

export async function addProject(
  directory: string,
  opts?: { name?: string; targetBranch?: string },
): Promise<Project> {
  const res = await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ directory, ...opts }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to add project" }));
    throw new Error(data.error || "Failed to add project");
  }
  return res.json();
}

export async function createProject(parentDirectory: string, name: string): Promise<Project> {
  const res = await fetch("/api/projects/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentDirectory, name }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to create project" }));
    throw new Error(data.error || "Failed to create project");
  }
  return res.json();
}

export async function updateProject(
  id: string,
  updates: {
    name?: string;
    targetBranch?: string | null;
    customInstructions?: string | null;
    defaultSpaceBranch?: string | null;
    spaceBranchSource?: "local" | "remote" | null;
    defaultProvider?: string | null;
    defaultModel?: string | null;
  },
): Promise<Project> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to update project" }));
    throw new Error(data.error || "Failed to update project");
  }
  return res.json();
}

export async function removeProject(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to remove project" }));
    throw new Error(data.error || "Failed to remove project");
  }
}

// =========================================================================
// Space API
// =========================================================================

export async function fetchSpaces(projectId: string): Promise<SpaceInfo[]> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/spaces`);
  if (!res.ok) throw new Error("Failed to fetch spaces");
  return res.json();
}

export async function createSpace(
  projectId: string,
  opts?: { name?: string; baseBranch?: string },
): Promise<SpaceInfo> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/spaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to create space" }));
    throw new Error(data.error || "Failed to create space");
  }
  return res.json();
}

export async function fetchSpaceDetail(spaceId: string): Promise<SpaceInfo> {
  const res = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}`);
  if (!res.ok) throw new Error("Failed to fetch space");
  return res.json();
}

export async function completeSpace(
  spaceId: string,
): Promise<{ success: boolean; targetBranch: string; mergeCommit?: string }> {
  const res = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}/complete`, {
    method: "POST",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to complete space" }));
    throw new Error(data.error || "Failed to complete space");
  }
  return res.json();
}

export async function deleteSpace(spaceId: string): Promise<void> {
  const res = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to delete space" }));
    throw new Error(data.error || "Failed to delete space");
  }
}

export async function fetchSpaceDiff(spaceId: string): Promise<string> {
  const res = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}/diff`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to fetch space diff" }));
    throw new Error(data.error || "Failed to fetch space diff");
  }
  const data = await res.json();
  return data.diff;
}
// ─── Branch & Git Operations ──────────────────────────────────────────────

interface BranchesResponse {
  local: string[];
  remote: string[];
  current: string | null;
  aheadBehind: { ahead: number; behind: number };
  dirty?: boolean;
}

interface GitOpResult {
  success: boolean;
  error?: string;
}

export async function fetchBranches(projectId: string): Promise<BranchesResponse> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/branches`);
  if (!res.ok) throw new Error("Failed to fetch branches");
  return res.json();
}

export async function checkoutBranch(projectId: string, branch: string): Promise<BranchesResponse> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: "Failed to switch branch" }));
    throw new Error(data.error || "Failed to switch branch");
  }
  return res.json();
}

export async function gitFetch(projectId: string): Promise<GitOpResult> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/git/fetch`, {
    method: "POST",
  });
  return res.json();
}

export async function gitPull(projectId: string): Promise<GitOpResult> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/git/pull`, {
    method: "POST",
  });
  return res.json();
}

export async function gitPush(
  projectId: string,
  opts?: { branch?: string; setUpstream?: boolean },
): Promise<GitOpResult> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/git/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  });
  return res.json();
}

// ─── Space Commit ────────────────────────────────────────────────────────

export async function commitSpace(
  spaceId: string,
  opts?: { message?: string },
): Promise<GitOpResult> {
  const res = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}/commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  });
  return res.json();
}

// ─── Space Push ───────────────────────────────────────────────────────────

interface PushSpaceResult {
  pushed: boolean;
  prUrl?: string;
  error?: string;
  ghNotFound?: boolean;
  ghNotAuthenticated?: boolean;
}

export async function pushSpace(
  spaceId: string,
  opts?: { createPR?: boolean },
): Promise<PushSpaceResult> {
  const res = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts ?? {}),
  });
  return res.json();
}
