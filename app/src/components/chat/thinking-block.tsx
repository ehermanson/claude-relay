import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { escapeHtml } from "../../lib/utils";

interface ThinkingBlockProps {
  text: string;
}

export function ThinkingBlock({ text }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="flex flex-col gap-1">
      <div className="border-l-2 border-l-claude/25 pl-4">
        <div
          onClick={() => setExpanded(!expanded)}
          className="flex cursor-pointer items-center gap-1.5"
        >
          <ChevronRight
            size={10}
            strokeWidth={2.5}
            className={`shrink-0 text-claude/50 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          <span className="text-[0.625rem] font-semibold uppercase tracking-wider text-claude/70">
            Thinking
          </span>
        </div>
        {expanded && (
          <div
            className="mt-1.5 max-h-96 overflow-y-auto whitespace-pre-wrap text-[0.75rem] leading-relaxed text-muted/80"
            dangerouslySetInnerHTML={{ __html: escapeHtml(text) }}
          />
        )}
      </div>
    </div>
  );
}
