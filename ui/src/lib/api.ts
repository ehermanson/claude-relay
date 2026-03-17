import type {
  CreateInstancePayload,
  HistoryEntry,
  InstanceInfo,
  NativeOpenTarget,
  NativeOpenTargetsResponse,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderKind,
  ProviderModelOption,
  ProjectArtifacts,
  SpaceInfo,
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

export async function fetchBeadsProjects(): Promise<string[]> {
  const res = await fetch("/api/beads-projects");
  if (!res.ok) return [];
  return res.json();
}

export async function fetchProjectIcons(): Promise<Record<string, string>> {
  const res = await fetch("/api/project-icons");
  if (!res.ok) return {};
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

export type { NativeOpenTarget };
