import { useState } from "react";
import type { ProviderKind } from "@shared/types";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";

const FILE_WRITE_GROUP = ["Edit", "Write", "NotebookEdit"];

function getProviderLabel(provider: ProviderKind): string {
  return provider === "codex" ? "Codex" : "Claude";
}

function getPermissionLabel(provider: ProviderKind, tool: string): string {
  const label = getProviderLabel(provider);
  if (FILE_WRITE_GROUP.includes(tool)) return `${label} needs permission to edit files`;
  if (tool === "Bash") return `${label} needs permission to run commands`;
  return `${label} needs permission to use ${tool}`;
}

export function PermissionBanner({
  provider,
  requestId,
  tool,
  description,
  onApprove,
}: {
  provider: ProviderKind;
  requestId: string;
  tool: string;
  description?: string;
  onApprove: (requestId: string, tool: string) => void;
}) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="animate-fade-in shrink-0 border-t border-accent/25 bg-accent/5">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-accent"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-medium text-text-bright">
            {getPermissionLabel(provider, tool)}
          </p>
          {description && <p className="truncate text-[0.75rem] text-muted">{description}</p>}
        </div>
        <Button variant="primary" className="shrink-0" onClick={() => onApprove(requestId, tool)}>
          Allow
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
