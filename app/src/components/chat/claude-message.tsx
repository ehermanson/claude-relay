import { useState, useRef, useEffect } from "react";
import { MarkdownContent } from "./markdown-content";
import { formatTimestamp } from "../../lib/utils";

interface ClaudeMessageProps {
  text: string;
  timestamp?: number;
  isLast?: boolean;
}

const COLLAPSED_HEIGHT = 400; // ~20 lines — only collapse truly massive intermediate messages

export function ClaudeMessage({ text, timestamp, isLast }: ClaudeMessageProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const measure = () => {
    const el = contentRef.current;
    if (!el) return;
    setIsOverflowing(el.scrollHeight > COLLAPSED_HEIGHT + 20);
  };

  useEffect(() => {
    measure();
  }, [text]);

  const collapsed = isOverflowing && !expanded && !isLast;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="min-w-0 overflow-hidden px-1 py-0.5 text-sm leading-relaxed text-text/80">
        <div
          ref={contentRef}
          className="relative min-w-0 overflow-hidden transition-[max-height] duration-200"
          style={collapsed ? { maxHeight: `${COLLAPSED_HEIGHT}px` } : undefined}
        >
          <MarkdownContent text={text} />
          {collapsed && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-bg to-transparent" />
          )}
        </div>
        {isOverflowing && !isLast && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="mt-1.5 text-[0.8125rem] font-medium text-muted/70 transition-colors hover:text-accent"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
      {timestamp && (
        <span className="px-1 text-[10px] text-muted/45">{formatTimestamp(timestamp)}</span>
      )}
    </div>
  );
}
