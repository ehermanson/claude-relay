import { formatTimestamp } from "../../lib/utils";

interface UserMessageProps {
  text: string;
  timestamp?: number;
}

export function UserMessage({ text, timestamp }: UserMessageProps) {
  return (
    <div className="animate-fade-in flex max-w-[85%] flex-col items-end gap-1 self-end">
      <div className="message-user whitespace-pre-wrap break-words rounded-md rounded-br-sm border border-user-border bg-user-bg px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-user-text">
        {text}
      </div>
      {timestamp && (
        <span className="px-1 text-[0.625rem] text-muted">
          {formatTimestamp(timestamp)}
        </span>
      )}
    </div>
  );
}
