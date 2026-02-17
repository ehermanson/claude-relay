export function ThinkingIndicator() {
  return (
    <div className="flex items-start">
      <div className="flex items-center gap-[5px] rounded-2xl border border-claude/10 bg-claude-dim px-4 py-3">
        <span className="h-[7px] w-[7px] animate-bounce-dot rounded-full bg-claude/50 [animation-delay:-0.32s]" />
        <span className="h-[7px] w-[7px] animate-bounce-dot rounded-full bg-claude/50 [animation-delay:-0.16s]" />
        <span className="h-[7px] w-[7px] animate-bounce-dot rounded-full bg-claude/50" />
      </div>
    </div>
  );
}
