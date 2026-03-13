import type {
  CreateInstancePayload,
  HistoryEntry,
  InstanceInfo,
  NativeOpenTarget,
  NativeOpenTargetsResponse,
  ProviderKind,
  ProviderModelOption,
  ProjectArtifacts,
} from "@shared/types";

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

export async function browsePath(prefix: string): Promise<{ home: string; directories: string[] }> {
  const res = await fetch("/api/browse?prefix=" + encodeURIComponent(prefix));
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

export async function fetchProviderModels(provider: ProviderKind): Promise<ProviderModelOption[]> {
  const res = await fetch(`/api/provider-models?provider=${encodeURIComponent(provider)}`);
  if (!res.ok) throw new Error("Failed to fetch provider models");
  const data = (await res.json()) as { models?: ProviderModelOption[] };
  return data.models ?? [];
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

export async function fetchBeadsProjects(): Promise<string[]> {
  const res = await fetch("/api/beads-projects");
  if (!res.ok) return [];
  return res.json();
}

export async function fetchProjectArtifacts(projectId: string): Promise<ProjectArtifacts> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
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

export type { NativeOpenTarget };
