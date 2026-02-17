import { escapeHtml } from "../../lib/utils";

interface ThinkingBlockProps {
  text: string;
}

export function ThinkingBlock({ text }: ThinkingBlockProps) {
  return (
    <div className="animate-fade-in max-w-[85%] self-start whitespace-pre-wrap rounded-md rounded-bl-sm border border-claude/10 border-l-2 border-l-claude bg-claude/5 px-3.5 py-2.5 text-xs italic leading-relaxed text-muted">
      <div className="mb-1 text-[0.625rem] font-semibold not-italic uppercase tracking-wider text-claude">
        Thinking
      </div>
      <span dangerouslySetInnerHTML={{ __html: escapeHtml(text) }} />
    </div>
  );
}
