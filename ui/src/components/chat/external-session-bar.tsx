import { useState } from "react";
import { Eye, Terminal } from "lucide-react";
import { Button } from "../ui/button";
import { ProviderLogo } from "./input-area/shared";
import { getProviderDisplayName } from "@shared/provider-catalog";
import type { ProviderKind } from "@shared/types";

interface ExternalSessionBarProps {
  isStopped: boolean;
  isConnected: boolean;
  onTakeover: () => void;
  provider: ProviderKind;
  model?: string;
}

export function ExternalSessionBar({
  isStopped,
  isConnected,
  onTakeover,
  provider,
  model,
}: ExternalSessionBarProps) {
  const [showConfirm, setShowConfirm] = useState(false);

  const providerLabel = getProviderDisplayName(provider);
  const modelLabel = model ?? providerLabel;

  if (showConfirm && !isStopped) {
    return (
      <div className="shrink-0 safe-area-bottom">
        <div className="mx-auto max-w-3xl px-6 pb-4 max-md:px-2 max-md:pb-1.5">
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/[0.05] px-4 py-3">
            <div className="flex items-start gap-2">
              <Terminal size={16} className="mt-0.5 shrink-0 text-amber-500" />
              <div className="flex-1">
                <p className="text-[0.8125rem] font-medium text-text-bright">
                  Taking over will stop the terminal process.
                </p>
                <p className="mt-0.5 text-[0.75rem] text-muted">
                  You won't be able to resume it in the terminal afterward.
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowConfirm(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" disabled={!isConnected} onClick={onTakeover}>
                Take over
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 safe-area-bottom">
      <div className="mx-auto max-w-3xl px-6 pb-4 max-md:px-2 max-md:pb-1.5">
        <div className="flex items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Eye size={16} className="shrink-0 text-muted" />
            <div className="flex items-center gap-2">
              <p className="text-[0.8125rem] text-muted">
                {isStopped ? "Terminal session ended" : "Observing terminal session"}
              </p>
              <span className="text-border">·</span>
              <span className="flex items-center gap-1.5">
                <ProviderLogo provider={provider} className="h-3 w-3" muted />
                <span className="text-[0.8125rem] text-muted">{modelLabel}</span>
              </span>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={!isConnected}
            onClick={() => (isStopped ? onTakeover() : setShowConfirm(true))}
          >
            {isStopped ? "Resume session" : "Take over session"}
          </Button>
        </div>
      </div>
    </div>
  );
}
