import { useState } from "react";
import { GitMerge, X } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";

export function MergeBanner({ onMerge }: { onMerge: () => void }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="animate-fade-in shrink-0 border-t border-green-500/25 bg-green-500/5">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500/15">
          <GitMerge size={16} className="text-green-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-medium text-text-bright">Ready to merge into main</p>
        </div>
        <Button
          variant="primary"
          className="shrink-0 bg-green-600 hover:bg-green-700"
          onClick={onMerge}
        >
          Merge
        </Button>
        <Tooltip content="Dismiss">
          <Button variant="icon" className="shrink-0" onClick={() => setDismissed(true)}>
            <X size={14} />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
