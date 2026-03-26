import type { ProviderKind } from "@shared/types";
import type { StatusDotVariant } from "@/components/ui/status-dot";

/** Map an instance status to a StatusDot variant. */
export function instanceStatusVariant(status: string, pendingTool?: boolean): StatusDotVariant {
  if (pendingTool || status === "processing") return "active";
  if (status === "error") return "error";
  if (status === "idle") return "success";
  return "default";
}

export function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function formatTimeAgo(timestamp: number | string): string {
  const ms = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp;
  const diff = Date.now() - ms;
  if (isNaN(diff)) return "";
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + "m ago";
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + "h ago";
  const days = Math.floor(diff / 86_400_000);
  if (days < 30) return days + "d ago";
  return new Date(ms).toLocaleDateString();
}

export function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return time;
  }
  const day = date.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${day}, ${time}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

export function getDisplayTokenBreakdown(usage: {
  providerName?: ProviderKind | string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}): {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
} {
  const cacheTokens = usage.cacheCreationTokens + usage.cacheReadTokens;
  const inputTokens =
    usage.providerName === "codex"
      ? Math.max(0, usage.inputTokens - usage.cacheReadTokens)
      : usage.inputTokens;
  return {
    inputTokens,
    outputTokens: usage.outputTokens,
    cacheTokens,
    totalTokens: inputTokens + usage.outputTokens + cacheTokens,
  };
}

export function getDisplaySessionStats(
  providerName: ProviderKind | string | undefined,
  stats: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  },
): {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
} {
  const display = getDisplayTokenBreakdown({
    providerName,
    inputTokens: stats.inputTokens,
    outputTokens: stats.outputTokens,
    cacheCreationTokens: stats.cacheCreationTokens,
    cacheReadTokens: stats.cacheReadTokens,
  });
  return {
    inputTokens: display.inputTokens,
    outputTokens: display.outputTokens,
    cacheCreationTokens: stats.cacheCreationTokens,
    cacheReadTokens: stats.cacheReadTokens,
    totalTokens: display.totalTokens,
  };
}

/** Turn a model ID like "claude-opus-4-6" into a short display name like "Opus 4.6" */
export function formatModel(model: string): string {
  // Match "claude-{family}-{major}-{minor}" or "claude-{family}-{major}"
  const m = model.match(/^claude-(\w+)-(\d+)(?:-(\d+))?/);
  if (!m) return model;
  const family = m[1].charAt(0).toUpperCase() + m[1].slice(1);
  const version = m[3] ? `${m[2]}.${m[3]}` : m[2];
  return `${family} ${version}`;
}

export function getCollapsedDetail(detail: string, tool?: string): string {
  if (!detail) return "";
  if (tool === "Read" || tool === "Edit" || tool === "Write") {
    const parts = detail.split("/");
    if (parts.length > 1) {
      return parts[parts.length - 1];
    }
  }
  if (tool === "Bash") {
    if (detail.length > 80) {
      return detail.slice(0, 80) + "\u2026";
    }
  }
  if (detail.length > 100) {
    return detail.slice(0, 100) + "\u2026";
  }
  return detail;
}
