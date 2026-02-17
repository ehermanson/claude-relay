import { useEffect, useRef } from "react";
import { UserMessage } from "./UserMessage";
import { ClaudeMessage } from "./ClaudeMessage";
import { SystemMessage } from "./SystemMessage";
import { ThinkingBlock } from "./ThinkingBlock";
import { ThinkingIndicator } from "./ThinkingIndicator";
import { ActivityGroup } from "./ActivityGroup";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import type { ChatItem } from "../../hooks/useInstanceMessages";

interface MessageListProps {
  items: ChatItem[];
  onSendMessage?: (text: string) => void;
  isInteractive?: boolean;
  onApproveTool?: (tool: string) => void;
  approvedTools?: Set<string>;
}

export function MessageList({ items, onSendMessage, isInteractive, onApproveTool, approvedTools }: MessageListProps) {
  const { ref, scrollToBottom, onContentChange } = useAutoScroll<HTMLDivElement>();

  // Scroll to bottom immediately when items first load (history replay)
  const hadItems = useRef(false);
  useEffect(() => {
    if (items.length > 0 && !hadItems.current) {
      hadItems.current = true;
      requestAnimationFrame(scrollToBottom);
    } else if (items.length === 0) {
      hadItems.current = false;
    } else {
      onContentChange();
    }
  }, [items, scrollToBottom, onContentChange]);

  // Only the last activity-group gets the Allow button
  let lastActivityGroupIndex = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "activity-group") {
      lastActivityGroupIndex = i;
      break;
    }
  }

  return (
    <div
      ref={ref}
      className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-5 [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-border"
    >
      {items.map((item, i) => {
        switch (item.kind) {
          case "user":
            return <UserMessage key={i} text={item.text} timestamp={item.timestamp} />;
          case "claude":
            return <ClaudeMessage key={i} text={item.text} timestamp={item.timestamp} />;
          case "system":
            return (
              <SystemMessage key={i} text={item.text} isError={item.isError} />
            );
          case "thinking-block":
            return <ThinkingBlock key={i} text={item.text} />;
          case "thinking-indicator":
            return <ThinkingIndicator key={i} />;
          case "activity-group":
            return <ActivityGroup key={i} activities={item.activities} onSendMessage={onSendMessage} isInteractive={isInteractive} onApproveTool={i === lastActivityGroupIndex ? onApproveTool : undefined} approvedTools={approvedTools} />;
        }
      })}
    </div>
  );
}
