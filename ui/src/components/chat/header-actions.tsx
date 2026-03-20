import { Info } from "lucide-react";
import type { SessionStats } from "@shared/types";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import { ContextRing } from "./input-area/shared";

export const HEADER_SPLIT_BUTTON_WIDTH_CLASS = "w-[11.5rem]";

export function HeaderActionDivider() {
  return <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border/60" />;
}

export function HeaderIconSkeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`h-7 w-7 shrink-0 animate-pulse rounded-md border border-border/50 bg-surface-hover/80 ${className}`}
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
    <Tooltip content={tooltip ?? (active ? "Hide context" : "Show context")}>
      <Button variant="icon" toggled={active} onClick={onClick} className="shrink-0">
        <Info size={15} strokeWidth={2} />
      </Button>
    </Tooltip>
  );
}
