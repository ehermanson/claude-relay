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

interface ModelSwitchDividerProps {
  fromModel?: string;
  toModel?: string;
  fromModelLabel?: string;
  toModelLabel?: string;
  timestamp?: number;
}

/** Divider line marking a mid-conversation model switch (like the compaction line). */
export function ModelSwitchDivider({
  fromModel,
  toModel,
  fromModelLabel,
  toModelLabel,
  timestamp,
}: ModelSwitchDividerProps) {
  const timeLabel = formatTimestamp(timestamp);
  const from = fromModelLabel ?? fromModel;
  const to = toModelLabel ?? toModel;

  const label =
    from && to ? `Model: ${from} → ${to}` : to ? `Model changed to ${to}` : "Model changed";

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="h-px flex-1 bg-border/60" />
      <div className="rounded-full border border-border/70 bg-surface/80 px-3 py-1 text-[0.6875rem] text-muted">
        {label}
        {timeLabel ? ` at ${timeLabel}` : ""}
      </div>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}
