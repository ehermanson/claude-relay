import { useEffect } from "react";
import type { SessionStats } from "@shared/types";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { formatTokens, getContextWindowUsage, rateLimitHexColor } from "@/lib/utils";

const CONTEXT_WINDOW = 1_000_000;

// Injected once — shared across all ContextRing instances.
const HALO_KEYFRAME_ID = "context-ring-halo-kf";
const HALO_KEYFRAMES = `
@keyframes context-ring-halo {
  0%   { opacity: .5;  transform: scale(1);   }
  80%  { opacity: .1;                          }
  100% { opacity: 0;   transform: scale(1.65); }
}`;

function useHaloKeyframes() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(HALO_KEYFRAME_ID)) return;
    const style = document.createElement("style");
    style.id = HALO_KEYFRAME_ID;
    style.textContent = HALO_KEYFRAMES;
    document.head.appendChild(style);
  }, []);
}

export function ContextRing({
  stats,
  active,
  onClick,
  rateLimitStatus,
}: {
  stats: SessionStats;
  active?: boolean;
  onClick?: () => void;
  rateLimitStatus?: "allowed_warning" | "rejected" | null;
}) {
  useHaloKeyframes();

  const usage = getContextWindowUsage({
    contextTokens: stats.contextTokens,
    contextWindow: stats.contextWindow ?? CONTEXT_WINDOW,
  });
  if (!usage.contextTokens) return null;

  const pct = usage.usagePct / 100;
  const used = Math.round(usage.usagePct);
  const r = 9;
  const svgSize = 24;
  const cx = svgSize / 2;
  const cy = svgSize / 2;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - pct);
  const ringColor = rateLimitHexColor(rateLimitStatus, usage.usagePct);

  // Button tint matches ring color family so the accent background doesn't clash.
  const buttonClass =
    rateLimitStatus === "rejected"
      ? active
        ? "bg-red-400/15 text-red-400 hover:bg-red-400/20 hover:text-red-400"
        : "text-red-400 hover:bg-red-400/10 hover:text-red-400"
      : rateLimitStatus === "allowed_warning"
        ? active
          ? "bg-amber-400/15 text-amber-400 hover:bg-amber-400/20 hover:text-amber-400"
          : "text-amber-400 hover:bg-amber-400/10 hover:text-amber-400"
        : "";

  return (
    <Tooltip
      content={
        <div className="space-y-0.5 text-center">
          <div className="font-semibold text-text">Context Window</div>
          <div>
            {used}% used &middot; {100 - used}% left
          </div>
          <div>
            {formatTokens(usage.contextTokens)} / {formatTokens(usage.contextWindow)} tokens
          </div>
          {rateLimitStatus === "allowed_warning" && (
            <div className="text-amber-400">Rate limit warning</div>
          )}
          {rateLimitStatus === "rejected" && <div className="text-red-400">Rate limit reached</div>}
        </div>
      }
      delay={200}
    >
      <div className="relative inline-flex">
        <Button
          variant="icon"
          onClick={onClick}
          toggled={!rateLimitStatus && active}
          className={buttonClass}
        >
          <svg
            width={svgSize}
            height={svgSize}
            viewBox={`0 0 ${svgSize} ${svgSize}`}
            style={{ overflow: "visible" }}
          >
            {/* Halo — pulses 3 times then fades; remounts on status change to replay */}
            {rateLimitStatus && (
              <circle
                key={rateLimitStatus}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={ringColor}
                strokeWidth={2}
                style={{
                  transformBox: "fill-box",
                  transformOrigin: "center",
                  opacity: 0,
                  filter: `drop-shadow(0 0 3px ${ringColor})`,
                  animationName: "context-ring-halo",
                  animationDuration: "1.5s",
                  animationTimingFunction: "ease-out",
                  animationIterationCount: 3,
                  animationFillMode: "forwards",
                }}
              />
            )}
            {/* Track */}
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.2}
              strokeWidth={2.5}
            />
            {/* Progress arc */}
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={ringColor}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={dashOffset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
            {/* Label */}
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fill={ringColor}
              fontSize="8"
              fontWeight="500"
            >
              {used}
            </text>
          </svg>
        </Button>
      </div>
    </Tooltip>
  );
}
