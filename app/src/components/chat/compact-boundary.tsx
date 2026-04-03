function formatTimestamp(timestamp?: number): string | null {
  if (!timestamp) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(timestamp);
  } catch {
    return null;
  }
}

interface CompactBoundaryProps {
  timestamp?: number;
}

export function CompactBoundary({ timestamp }: CompactBoundaryProps) {
  const timeLabel = formatTimestamp(timestamp);

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-border/60" />
      <div className="rounded-full border border-border/70 bg-surface/80 px-3 py-1 text-[0.6875rem] text-muted">
        Context compacted{timeLabel ? ` at ${timeLabel}` : ""}
      </div>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}
