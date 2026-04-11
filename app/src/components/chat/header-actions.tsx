import { Info } from "lucide-react";
import type { SessionStats } from "@shared/types";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import { ContextRing } from "@/components/ui/context-ring";

export function HeaderIconSkeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`h-7 w-7 shrink-0 animate-pulse rounded-md border border-border/50 bg-surface-hover/80 max-[768px]:h-10 max-[768px]:w-10 max-[768px]:rounded-xl ${className}`}
    />
  );
}

export function HeaderContextToggle({
  stats,
  active,
  onClick,
  tooltip,
}: {
  stats?: SessionStats | null;
  active?: boolean;
  onClick?: () => void;
  tooltip?: string;
}) {
  if (stats?.contextTokens) {
    return <ContextRing stats={stats} active={active} onClick={onClick} />;
  }

  return (
    <Tooltip content={tooltip ?? (active ? "Hide current context" : "Show current context")}>
      <Button variant="icon" toggled={active} onClick={onClick} className="shrink-0">
        <Info size={15} strokeWidth={2} />
      </Button>
    </Tooltip>
  );
}
