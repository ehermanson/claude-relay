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
  provider: import("@shared/types").ProviderKind,
): Promise<import("@shared/types").ProviderModelOption[]> {
  const res = await fetch(`/api/provider-models?provider=${encodeURIComponent(provider)}`);
  if (!res.ok) throw new Error("Failed to fetch provider models");
  const data = (await res.json()) as { models?: import("@shared/types").ProviderModelOption[] };
  return data.models ?? [];
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

export async function fetchGitHubLinks(): Promise<Record<string, string>> {
  const res = await fetch("/api/github-links");
  if (!res.ok) return {};
  return res.json();
}

export async function fetchBeadsProjects(): Promise<string[]> {
  const res = await fetch("/api/beads-projects");
  if (!res.ok) return [];
  return res.json();
}

export async function fetchProjectArtifacts(
  projectId: string,
): Promise<import("@shared/types").ProjectArtifacts> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
  if (!res.ok) throw new Error("Failed to fetch project");
  return res.json();
}
