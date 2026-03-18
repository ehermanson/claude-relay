import type {
  CreateInstancePayload,
  HistoryEntry,
  InstanceInfo,
  NativeOpenTarget,
  NativeOpenTargetsResponse,
  Project,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderKind,
  ProviderModelOption,
  ProjectArtifacts,
} from "@shared/types";
import { getDefaultProviderCapabilities } from "@shared/provider-catalog";

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

export async function fetchDashboardStats(): Promise<import("@shared/types").DashboardStats> {
  const res = await fetch("/api/stats");
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

// ─── Task CRUD ────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: number;
  type?: import("@shared/types").TaskType;
  tags?: string[];
  parent?: string | null;
  blockedBy?: string[];
}

export interface UpdateTaskInput {
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
  const res = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
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
  const res = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
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

export async function fetchProjectArtifacts(projectId: string): Promise<ProjectArtifacts> {
  const res = await fetch(`/api/project-artifacts/${encodeURIComponent(projectId)}`);
  if (!res.ok) throw new Error("Failed to fetch project");
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

export async function updateProject(
  id: string,
  updates: { name?: string; targetBranch?: string | null },
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

export type { NativeOpenTarget };
