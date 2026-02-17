import { MarkdownContent } from "./MarkdownContent";
import { formatTimestamp } from "../../lib/utils";

interface ClaudeMessageProps {
  text: string;
  timestamp?: number;
}

export function ClaudeMessage({ text, timestamp }: ClaudeMessageProps) {
  return (
    <div className="animate-fade-in flex max-w-[85%] flex-col gap-1 self-start">
      <div className="rounded-md rounded-bl-sm border border-border border-l-2 border-l-claude bg-surface px-3.5 py-2.5 text-[0.8125rem] leading-relaxed">
        <MarkdownContent text={text} />
      </div>
      {timestamp && (
        <span className="px-1 text-[0.625rem] text-muted">
          {formatTimestamp(timestamp)}
        </span>
      )}
    </div>
  );
}
