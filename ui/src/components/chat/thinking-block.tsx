import { escapeHtml } from "../../lib/utils";

interface ThinkingBlockProps {
  text: string;
}

export function ThinkingBlock({ text }: ThinkingBlockProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="border-l-2 border-l-claude/25 pl-4">
        <div className="mb-1.5 text-[0.625rem] font-semibold uppercase tracking-wider text-claude/70">
          Thinking
        </div>
        <div
          className="whitespace-pre-wrap text-[0.8125rem] italic leading-relaxed text-muted"
          dangerouslySetInnerHTML={{ __html: escapeHtml(text) }}
        />
      </div>
    </div>
  );
}
