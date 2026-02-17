import { useState, useRef, useEffect, useCallback } from "react";
import { MarkdownContent } from "./markdown-content";
import { formatTimestamp } from "../../lib/utils";

interface ClaudeMessageProps {
  text: string;
  timestamp?: number;
  isLast?: boolean;
}

const COLLAPSED_HEIGHT = 96; // ~4 lines

export function ClaudeMessage({ text, timestamp, isLast }: ClaudeMessageProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const measure = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    setIsOverflowing(el.scrollHeight > COLLAPSED_HEIGHT + 20);
  }, []);

  useEffect(() => {
    measure();
  }, [text, measure]);

  const collapsed = isOverflowing && !expanded && !isLast;

  return (
    <div className="animate-fade-in flex min-w-0 flex-col gap-1">
      <div className="min-w-0 overflow-hidden border-l-2 border-l-claude/30 pl-4 text-[0.875rem] leading-relaxed">
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
            className="mt-1 text-[0.8125rem] font-medium text-muted transition-colors hover:text-accent"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
      </div>
      {timestamp && (
        <span className="pl-4 text-[0.6875rem] text-muted">{formatTimestamp(timestamp)}</span>
      )}
    </div>
  );
}
