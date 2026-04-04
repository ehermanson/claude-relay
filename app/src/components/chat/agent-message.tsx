import { useState, useRef } from "react";
import { MarkdownContent } from "./markdown-content";
import { MessageHoverToolbar } from "./message-hover-toolbar";
import { formatTimestamp } from "../../lib/utils";

interface AgentMessageProps {
  text: string;
  timestamp?: number;
}

export function AgentMessage({ text, timestamp }: AgentMessageProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative flex min-w-0 flex-col gap-1.5"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <MessageHoverToolbar text={text} visible={hovered} />
      <div className="min-w-0 overflow-hidden px-1 py-0.5 text-sm leading-relaxed text-text/80">
        <div
          ref={contentRef}
          className="relative min-w-0 overflow-hidden transition-[max-height] duration-200"
        >
          <MarkdownContent text={text} />
        </div>
      </div>
      {timestamp && (
        <span className="px-1 text-[10px] text-muted/45">{formatTimestamp(timestamp)}</span>
      )}
    </div>
  );
}
