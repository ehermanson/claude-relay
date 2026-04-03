import { ChevronUp } from "lucide-react";

interface CollapsedTerminalBarProps {
  terminalCount: number;
  onExpand: () => void;
}

export function CollapsedTerminalBar({ terminalCount, onExpand }: CollapsedTerminalBarProps) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="group flex w-full items-center justify-center gap-1.5 border-t border-border/50 bg-surface-inset px-3 py-1 text-[0.6875rem] text-muted transition-colors hover:bg-surface-hover hover:text-text"
    >
      <ChevronUp size={12} className="transition-transform group-hover:-translate-y-0.5" />
      <span>
        {terminalCount} terminal{terminalCount !== 1 ? "s" : ""}
      </span>
    </button>
  );
}
