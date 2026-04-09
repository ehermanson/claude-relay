import type { InstanceInfo, ProviderKind } from "@shared/types";
import type { StatusDotVariant } from "@/components/ui/status-dot";

export interface InstanceStatusPresentation {
  variant: StatusDotVariant;
  dotClass: string;
  label: string;
}

export function deriveInstanceStatusPresentation(
  instance: Pick<InstanceInfo, "status" | "external" | "pendingTool">,
): InstanceStatusPresentation {
  if (instance.status === "stopped") {
    return {
      variant: "default",
      dotClass: "bg-muted",
      label: instance.external ? "External chat (ended)" : "Ended",
    };
  }
  if (instance.pendingTool) {
    return {
      variant: "active",
      dotClass: "animate-pulse-dot bg-warning",
      label: "Waiting for permission",
    };
  }
  if (instance.status === "processing") {
    return {
      variant: "active",
      dotClass: "animate-pulse-dot bg-warning",
      label: instance.external ? "External chat (active)" : "Processing",
    };
  }
  if (instance.status === "error") {
    return {
      variant: "error",
      dotClass: "bg-error",
      label: "Error",
    };
  }
  if (instance.external) {
    return {
      variant: "success",
      dotClass: "bg-accent",
      label: "External chat",
    };
  }
  return {
    variant: "success",
    dotClass: "bg-accent",
    label: "Idle",
  };
}

/** Map an instance to a StatusDot variant. */
export function instanceStatusVariant(
  statusOrInstance: string | Pick<InstanceInfo, "status" | "external" | "pendingTool">,
  pendingTool?: boolean,
): StatusDotVariant {
  if (typeof statusOrInstance === "string") {
    return deriveInstanceStatusPresentation({
      status: statusOrInstance as InstanceInfo["status"],
      external: false,
      pendingTool: pendingTool ? "pending" : undefined,
    }).variant;
  }
  return deriveInstanceStatusPresentation(statusOrInstance).variant;
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

export function formatTimeUntil(timestamp: number | string): string {
  const ms = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp;
  const diff = ms - Date.now();
  if (isNaN(diff) || diff <= 0) return "";
  if (diff < 60_000) return "<1m";
  if (diff < 3_600_000) return Math.ceil(diff / 60_000) + "m";
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    const m = Math.ceil((diff % 3_600_000) / 60_000);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return Math.ceil(diff / 86_400_000) + "d";
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

export function getContextWindowUsage(stats: { contextTokens?: number; contextWindow?: number }): {
  contextTokens: number;
  contextWindow: number;
  usagePct: number;
} {
  const contextWindow = stats.contextWindow && stats.contextWindow > 0 ? stats.contextWindow : 0;
  const rawContextTokens = stats.contextTokens ?? 0;
  if (!contextWindow || rawContextTokens <= 0) {
    return {
      contextTokens: 0,
      contextWindow,
      usagePct: 0,
    };
  }

  const contextTokens = Math.min(rawContextTokens, contextWindow);
  return {
    contextTokens,
    contextWindow,
    usagePct: Math.min(contextTokens / contextWindow, 1) * 100,
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
