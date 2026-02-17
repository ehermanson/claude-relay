export function ThinkingIndicator() {
  return (
    <div className="animate-fade-in flex items-center gap-2 self-start rounded-md rounded-bl-sm border border-border border-l-2 border-l-claude bg-surface px-3.5 py-2.5 text-xs text-muted">
      <div className="flex gap-[3px]">
        <span className="h-[5px] w-[5px] animate-bounce-dot rounded-full bg-claude [animation-delay:-0.32s]" />
        <span className="h-[5px] w-[5px] animate-bounce-dot rounded-full bg-claude [animation-delay:-0.16s]" />
        <span className="h-[5px] w-[5px] animate-bounce-dot rounded-full bg-claude" />
      </div>
      <span>Claude is thinking...</span>
    </div>
  );
}
