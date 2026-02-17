import { Progress as BaseProgress } from "@base-ui/react/progress";

interface ProgressProps {
  /** 0-100 */
  value: number;
  /** Track color class. Default: "bg-surface-hover" */
  trackClass?: string;
  /** Indicator color class. Default: "bg-claude" */
  indicatorClass?: string;
  className?: string;
}

export function Progress({
  value,
  trackClass = "bg-surface-hover",
  indicatorClass = "bg-claude",
  className = "",
}: ProgressProps) {
  return (
    <BaseProgress.Root value={value} className={className}>
      <BaseProgress.Track className={`h-1 overflow-hidden rounded-full ${trackClass}`}>
        <BaseProgress.Indicator
          className={`h-full rounded-full transition-all duration-300 ${indicatorClass}`}
        />
      </BaseProgress.Track>
    </BaseProgress.Root>
  );
}
