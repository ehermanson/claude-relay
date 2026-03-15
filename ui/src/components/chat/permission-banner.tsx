import { useState } from "react";
import { Lock, X } from "lucide-react";
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
  const [exiting, setExiting] = useState(false);
  const [gone, setGone] = useState(false);
  const [pendingApprove, setPendingApprove] = useState(false);

  if (gone) return null;

  const handleExit = () => {
    setExiting(true);
  };

  const handleApprove = () => {
    setPendingApprove(true);
    setExiting(true);
  };

  return (
    <div
      className={`shrink-0 overflow-hidden ${exiting ? "animate-fade-out-collapse" : "mb-2"}`}
      onAnimationEnd={() => {
        if (exiting) {
          setGone(true);
          if (pendingApprove) onApprove(requestId, tool);
        }
      }}
    >
      <div className="mx-auto max-w-3xl px-6">
        <div className="animate-fade-in flex items-center gap-3 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/15">
            <Lock size={16} className="text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[0.8125rem] font-medium text-text-bright">
              {getPermissionLabel(provider, tool)}
            </p>
            {description && <p className="truncate text-[0.75rem] text-muted">{description}</p>}
          </div>
          <Button variant="primary" className="shrink-0" onClick={handleApprove}>
            Allow
          </Button>
          <Tooltip content="Dismiss">
            <Button variant="icon" className="shrink-0" onClick={handleExit}>
              <X size={14} />
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
