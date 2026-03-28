import type { SessionStats } from "@shared/types";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { formatTokens, getContextWindowUsage } from "@/lib/utils";

const CONTEXT_WINDOW = 1_000_000;

export function ContextRing({
  stats,
  active,
  onClick,
}: {
  stats: SessionStats;
  active?: boolean;
  onClick?: () => void;
}) {
  const usage = getContextWindowUsage({
    contextTokens: stats.contextTokens,
    contextWindow: stats.contextWindow ?? CONTEXT_WINDOW,
  });
  if (!usage.contextTokens) return null;

  const pct = usage.usagePct / 100;
  const used = Math.round(usage.usagePct);
  const r = 5;
  const size = 14;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - pct);
  const ringColor = pct > 0.9 ? "#ef4444" : pct > 0.7 ? "#f59e0b" : "currentColor";

  return (
    <Tooltip
      content={
        <div className="space-y-0.5 text-center">
          <div className="font-semibold text-text">Current context</div>
          <div>
            {used}% used &middot; {100 - used}% left
          </div>
          <div>
            {formatTokens(usage.contextTokens)} / {formatTokens(usage.contextWindow)} tokens
          </div>
          <div className="pt-1 text-muted">Latest prompt footprint, not session total</div>
          <div className="text-muted">Auto-compacts when full</div>
        </div>
      }
      delay={200}
    >
      <Button variant="icon" onClick={onClick} toggled={active}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeWidth={2}
          />
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={ringColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        </svg>
      </Button>
    </Tooltip>
  );
}
