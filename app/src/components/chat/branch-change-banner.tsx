import { GitBranch, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

export function BranchChangeBanner({
  originalBranch,
  currentBranch,
  onDismiss,
}: {
  originalBranch: string;
  currentBranch: string;
  onDismiss: () => void;
}) {
  return (
    <div className="shrink-0 pb-2">
      <div className="mx-auto max-w-3xl px-6 max-[768px]:px-2">
        <div className="animate-fade-in flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/8 px-4 py-3 max-[768px]:gap-2 max-[768px]:px-3 max-[768px]:py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/14">
            <GitBranch size={16} className="text-warning" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[0.8125rem] font-medium text-text-bright">
              This chat changed branches
            </p>
            <p className="mt-0.5 text-[0.75rem] text-muted">
              Started on <code className="font-medium text-text">{originalBranch}</code> and is now
              on <code className="font-medium text-text">{currentBranch}</code>.
            </p>
          </div>
          <Tooltip content="Dismiss">
            <Button variant="icon" className="shrink-0" onClick={onDismiss}>
              <X size={14} />
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
