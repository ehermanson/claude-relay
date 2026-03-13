import type { ProviderKind } from "@shared/types";

export function TerminalPermissionBar({
  provider,
  pendingTool,
}: {
  provider: ProviderKind;
  pendingTool: string;
}) {
  return (
    <div className="animate-fade-in shrink-0 border-t border-warning/25 bg-warning/5">
      <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/15">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-warning"
          >
            <path d="M4 17l6-6-6-6" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-medium text-warning">
            Waiting for your response in the terminal
          </p>
          <p className="text-[0.75rem] text-muted">
            {provider === "codex" ? "Codex" : "Claude"} is waiting for approval to use {pendingTool}
            . Switch to your terminal to respond.
          </p>
        </div>
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-pulse-dot rounded-full bg-warning opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-warning" />
        </span>
      </div>
    </div>
  );
}
