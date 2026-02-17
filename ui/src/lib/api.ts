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

export async function browsePath(
  prefix: string
): Promise<{ home: string; directories: string[] }> {
  const res = await fetch("/api/browse?prefix=" + encodeURIComponent(prefix));
  if (!res.ok) return { home: "", directories: [] };
  return res.json();
}
