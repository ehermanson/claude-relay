export function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function shortenPath(p: string, home?: string): string {
  if (!p) return "";
  if (home && p.startsWith(home)) {
    return "~" + p.slice(home.length);
  }
  return p;
}

export function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  return Math.floor(diff / 86400000) + "d ago";
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

export function formatCost(usd: number): string {
  if (usd < 0.005) return "$0.00";
  if (usd < 10) return "$" + usd.toFixed(2);
  return "$" + usd.toFixed(1);
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
