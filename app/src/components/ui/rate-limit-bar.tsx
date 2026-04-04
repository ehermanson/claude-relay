import type { ProviderRateLimitWindow } from "@shared/types";
import { formatTimeUntil } from "../../lib/utils";

/**
 * Derive a human-readable label from the rate-limit window duration.
 *
 * Providers report windows with a `windowMinutes` field (e.g. 300 for a 5-hour
 * window, 10080 for a weekly window). We bucket these into the most natural
 * human-readable unit:
 *
 *   < 60 min  → "30m window"
 *   < 1 day   → "5h window"
 *   < 1 week  → "3d window"
 *   ≥ 1 week  → "Weekly"
 *
 * Falls back to the raw `window.label` from the provider (e.g. "Primary"),
 * or a generic "Window N" if neither is available.
 */
function windowLabel(window: ProviderRateLimitWindow, fallbackIndex: number): string {
  const w = window.windowMinutes;
  if (typeof w === "number" && w > 0) {
    if (w < 60) return `${w}m window`; // minutes
    if (w < 1440) return `${Math.round(w / 60)}h window`; // hours
    if (w < 10080) return `${Math.round(w / 1440)}d window`; // days
    return "Weekly";
  }
  return window.label ?? `Window ${fallbackIndex + 1}`;
}

export function RateLimitBar({
  window,
  index = 0,
  size = "sm",
}: {
  window: ProviderRateLimitWindow;
  /** Fallback index used when no label or windowMinutes are available. */
  index?: number;
  /** "sm" for sidecar, "md" for settings page. */
  size?: "sm" | "md";
}) {
  const pct = typeof window.usedPercent === "number" ? window.usedPercent : null;

  // Derive pct from remaining/limit when usedPercent isn't provided
  const derivedPct =
    pct === null &&
    typeof window.remaining === "number" &&
    typeof window.limit === "number" &&
    window.limit > 0
      ? ((window.limit - window.remaining) / window.limit) * 100
      : null;

  const effectivePct = pct ?? derivedPct;

  const barColor =
    effectivePct !== null && effectivePct > 90
      ? "bg-red-400"
      : effectivePct !== null && effectivePct > 70
        ? "bg-amber-400"
        : "bg-accent";

  const resetIn = window.resetAt
    ? formatTimeUntil(window.resetAt)
    : typeof window.windowMinutes === "number"
      ? `${window.windowMinutes}m window`
      : "";

  const label = windowLabel(window, index);
  const textSize = size === "sm" ? "text-[0.6875rem]" : "text-[0.75rem]";
  const barHeight = size === "sm" ? "h-1.5" : "h-2";

  // Usage text
  const usageText =
    pct !== null
      ? `${Math.round(pct)}% used`
      : typeof window.remaining === "number" && typeof window.limit === "number"
        ? `${window.limit - window.remaining} / ${window.limit}`
        : typeof window.remaining === "number"
          ? `${window.remaining} remaining`
          : "—";

  return (
    <div>
      <div className={`mb-1 flex items-center justify-between ${textSize} text-muted`}>
        <span>{label}</span>
        <span className="tabular-nums">
          {usageText}
          {resetIn ? <span className="ml-1.5 text-muted">(resets in {resetIn})</span> : null}
        </span>
      </div>
      {effectivePct !== null ? (
        <div className={`flex ${barHeight} w-full overflow-hidden rounded-full bg-surface-hover`}>
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.min(effectivePct, 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Flatten all rate-limit windows from a list of rate-limit statuses
 * into a flat array suitable for mapping over with <RateLimitBar>.
 */
export function flattenRateLimitWindows(
  rateLimits: { windows?: ProviderRateLimitWindow[] }[],
): { window: ProviderRateLimitWindow; key: string }[] {
  console.log({ rateLimits });
  return rateLimits.flatMap((limit, li) =>
    (limit.windows ?? []).map((w, wi) => ({
      window: w,
      key: `rl-${li}-${wi}`,
    })),
  );
}
