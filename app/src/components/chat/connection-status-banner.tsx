import { useState } from "react";
import { AlertTriangle, Loader2, RefreshCcw, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

type ConnectionBannerTone = "warning" | "accent";

interface ConnectionStatusBannerProps {
  kind: "reconnecting" | "resyncing" | "running" | "interrupted";
  onDismiss?: () => void;
  onContinue?: () => void;
  onRetry?: () => void;
}

function toneClasses(tone: ConnectionBannerTone): {
  border: string;
  bg: string;
  chip: string;
  icon: string;
} {
  if (tone === "warning") {
    return {
      border: "border-warning/25",
      bg: "bg-warning/8",
      chip: "bg-warning/14",
      icon: "text-warning",
    };
  }

  return {
    border: "border-accent/25",
    bg: "bg-accent/5",
    chip: "bg-accent/15",
    icon: "text-accent",
  };
}

export function ConnectionStatusBanner({
  kind,
  onDismiss,
  onContinue,
  onRetry,
}: ConnectionStatusBannerProps) {
  const [retrying, setRetrying] = useState(false);

  let title = "";
  let detail = "";
  let tone: ConnectionBannerTone = "accent";
  let Icon = RefreshCcw;
  let iconClassName = "";

  if (kind === "reconnecting") {
    title = "Reconnecting to Relay";
    detail = "The connection dropped. Relay will reconnect automatically.";
    tone = "warning";
    Icon = retrying ? Loader2 : WifiOff;
    iconClassName = retrying ? "animate-spin" : "";
  } else if (kind === "resyncing") {
    title = "Relay is back, restoring live state";
    detail = "Re-subscribing to this chat and refreshing its latest status.";
    Icon = Loader2;
    iconClassName = "animate-spin";
  } else if (kind === "running") {
    title = "Reconnected while this chat is still running";
    detail = "The agent is still marked processing, so new output should keep streaming here.";
    Icon = RefreshCcw;
  } else {
    title = "Reconnected, but this chat came back idle";
    detail =
      "If the server restarted during a managed turn, that work may have stopped. Use Continue to resume from the saved session.";
    tone = "warning";
    Icon = AlertTriangle;
  }

  const classes = toneClasses(tone);

  const handleRetry = () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    onRetry();
    setTimeout(() => setRetrying(false), 3_000);
  };

  return (
    <div className="shrink-0 pb-2">
      <div className="mx-auto max-w-3xl px-6 max-[768px]:px-2">
        <div
          className={`animate-fade-in flex items-start gap-3 rounded-xl border px-4 py-3 max-[768px]:gap-2 max-[768px]:px-3 max-[768px]:py-2 ${classes.border} ${classes.bg}`}
        >
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${classes.chip}`}
          >
            <Icon size={16} className={`${classes.icon} ${iconClassName}`.trim()} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[0.8125rem] font-medium text-text-bright">{title}</p>
            <p className="mt-0.5 text-[0.75rem] text-muted">{detail}</p>
          </div>
          {onRetry && (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              disabled={retrying}
              onClick={handleRetry}
            >
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          )}
          {onContinue && (
            <Button variant="primary" size="sm" className="shrink-0" onClick={onContinue}>
              Continue
            </Button>
          )}
          {onDismiss && (
            <Tooltip content="Dismiss">
              <Button variant="icon" className="shrink-0" onClick={onDismiss}>
                <X size={14} />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
