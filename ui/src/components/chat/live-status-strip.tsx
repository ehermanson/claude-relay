import { useState, useEffect, useRef } from "react";
import type { LiveActivity } from "../../hooks/use-instance-messages";

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

/** Icon for the current activity type */
function ActivityIcon({ activity }: { activity: LiveActivity | null; stale: boolean }) {
  const tool = activity?.tool;
  const desc = activity?.description ?? "";

  // Thinking — brain icon
  if (desc === "Thinking..." || desc.startsWith("Think")) {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-claude"
      >
        <path d="M9.5 3.5A5.5 5.5 0 0 0 7 14v1a2 2 0 0 0 2 2h.5" />
        <path d="M14.5 3.5A5.5 5.5 0 0 1 17 14v1a2 2 0 0 1-2 2h-.5" />
        <path d="M9 18h6" />
        <path d="M10 21h4" />
      </svg>
    );
  }

  // Bash / terminal
  if (tool === "Bash" || tool === "bash") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-accent"
      >
        <path d="M4 17l6-6-6-6" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    );
  }

  // Read / file operations
  if (
    tool === "Read" ||
    tool === "Edit" ||
    tool === "Write" ||
    tool === "Glob" ||
    tool === "Grep"
  ) {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-accent"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    );
  }

  // Agent / subagent
  if (tool === "Agent" || tool === "Task" || desc.toLowerCase().includes("agent")) {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-claude"
      >
        <circle cx="12" cy="8" r="5" />
        <path d="M20 21a8 8 0 0 0-16 0" />
      </svg>
    );
  }

  // Web fetch
  if (tool === "WebFetch" || tool === "WebSearch") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-accent"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    );
  }

  // Default — spinning gear
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 animate-spin text-muted [animation-duration:3s]"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
    </svg>
  );
}

interface LiveStatusStripProps {
  activity: LiveActivity | null;
  processingStartedAt: number | null;
  isProcessing: boolean;
  instanceStatus?: string;
}

export function LiveStatusStrip({
  activity,
  processingStartedAt,
  isProcessing,
  instanceStatus,
}: LiveStatusStripProps) {
  const showStrip = isProcessing || instanceStatus === "processing";
  const [now, setNow] = useState(Date.now);
  const lastEventRef = useRef(Date.now());

  // Tick every second while visible
  useEffect(() => {
    if (!showStrip) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [showStrip]);

  // Track when we last received an activity update (for stale detection)
  useEffect(() => {
    if (activity) {
      lastEventRef.current = Date.now();
    }
  }, [activity?.description, activity?.tool]);

  if (!showStrip) return null;

  const silenceMs = now - lastEventRef.current;
  const isStale = silenceMs > 15_000;
  const isVeryStale = silenceMs > 60_000;

  // Elapsed since this specific activity started (or since processing began)
  const elapsedMs = activity
    ? now - activity.startedAt
    : processingStartedAt
      ? now - processingStartedAt
      : 0;

  // Description text
  let description: string;
  if (isVeryStale) {
    description = "No activity for " + formatElapsed(silenceMs);
  } else if (isStale) {
    description = "Still working...";
  } else if (activity) {
    description = activity.description;
  } else {
    description = "Working...";
  }

  return (
    <div className="flex items-center gap-2.5 px-1 py-2">
      {/* Pulsing dot or icon */}
      <div className="flex items-center justify-center">
        {isVeryStale ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 text-warning"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        ) : isStale ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 animate-pulse text-muted"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        ) : (
          <ActivityIcon activity={activity} stale={false} />
        )}
      </div>

      {/* Description */}
      <span
        className={`min-w-0 truncate text-[0.8125rem] ${
          isVeryStale ? "text-warning" : "text-muted"
        }`}
      >
        {description}
      </span>

      {/* Elapsed timer */}
      {elapsedMs >= 1000 && (
        <span className="shrink-0 tabular-nums text-[0.75rem] text-muted/50">
          {formatElapsed(elapsedMs)}
        </span>
      )}
    </div>
  );
}
