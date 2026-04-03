import { lazy, Suspense } from "react";
import type { MouseEvent } from "react";
import type { TerminalScope } from "@shared/types";

const TerminalPanel = lazy(() =>
  import("./terminal-panel").then((m) => ({ default: m.TerminalPanel })),
);

interface LazyTerminalPanelProps {
  scope: TerminalScope;
  height: number;
  onResizeStart: (e: MouseEvent) => void;
  activeInstanceId?: string | null;
}

function TerminalPanelFallback({ height }: { height: number }) {
  return (
    <div className="flex flex-col border-t border-border/50 bg-surface-inset" style={{ height }}>
      <div
        className="h-px shrink-0 bg-border/50 after:absolute after:inset-x-0 after:top-1/2 after:h-2 after:-translate-y-1/2 after:content-['']"
        style={{ position: "relative" }}
      />
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted">
        Loading terminal…
      </div>
    </div>
  );
}

export function LazyTerminalPanel(props: LazyTerminalPanelProps) {
  return (
    <Suspense fallback={<TerminalPanelFallback height={props.height} />}>
      <TerminalPanel {...props} />
    </Suspense>
  );
}
