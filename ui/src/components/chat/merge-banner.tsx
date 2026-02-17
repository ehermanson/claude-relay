import { useState } from "react";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";

export function MergeBanner({ onMerge }: { onMerge: () => void }) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="animate-fade-in shrink-0 border-t border-green-500/25 bg-green-500/5">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500/15">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-green-500"
          >
            <circle cx="18" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <path d="M6 21V9a9 9 0 0 0 9 9" />
          </svg>
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
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
