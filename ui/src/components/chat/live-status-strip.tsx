import { useState, useEffect, useRef } from "react";
import { AlertTriangle, Brain, Clock, Cog } from "lucide-react";
import type { LiveActivity } from "@/components/chat/types";
import { getToolIcon } from "@/components/chat/shared";

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

/** Icon for the current activity type */
function ActivityIcon({ activity }: { activity: LiveActivity | null; stale: boolean }) {
  const desc = activity?.description ?? "";

  // Thinking — brain icon
  if (desc === "Thinking..." || desc.startsWith("Think")) {
    return <Brain size={14} className="shrink-0 text-claude" />;
  }

  // Known tool — use shared icon registry
  if (activity?.tool) {
    const Icon = getToolIcon(activity.tool);
    return <Icon size={14} className="shrink-0 text-accent" />;
  }

  // Default — spinning gear
  return <Cog size={14} className="shrink-0 animate-spin text-muted [animation-duration:3s]" />;
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
          <AlertTriangle size={14} className="shrink-0 text-warning" />
        ) : isStale ? (
          <Clock size={14} className="shrink-0 animate-pulse text-muted" />
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
