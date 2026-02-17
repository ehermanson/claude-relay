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
  isExternal?: boolean;
}

export function MessageList({
  items,
  onSendMessage,
  isInteractive,
  onApproveTool,
  approvedTools,
  isExternal,
}: MessageListProps) {
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

  // Only the last activity-group is interactive (plan approval, questions, tool permissions)
  let lastActivityGroupIndex = -1;
  let lastClaudeIndex = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (lastActivityGroupIndex === -1 && items[i].kind === "activity-group") {
      lastActivityGroupIndex = i;
    }
    if (lastClaudeIndex === -1 && items[i].kind === "claude") {
      lastClaudeIndex = i;
    }
    if (lastActivityGroupIndex !== -1 && lastClaudeIndex !== -1) break;
  }

  return (
    <div ref={ref} className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
        {items.map((item, i) => {
          switch (item.kind) {
            case "user":
              return <UserMessage key={i} text={item.text} timestamp={item.timestamp} />;
            case "claude":
              return (
                <ClaudeMessage
                  key={i}
                  text={item.text}
                  timestamp={item.timestamp}
                  isLast={i === lastClaudeIndex}
                />
              );
            case "system":
              return <SystemMessage key={i} text={item.text} isError={item.isError} />;
            case "thinking-block":
              return <ThinkingBlock key={i} text={item.text} />;
            case "thinking-indicator":
              return <ThinkingIndicator key={i} />;
            case "activity-group": {
              const isLast = i === lastActivityGroupIndex;
              return (
                <ActivityGroup
                  key={i}
                  activities={item.activities}
                  onSendMessage={isLast ? onSendMessage : undefined}
                  isInteractive={isLast ? isInteractive : undefined}
                  onApproveTool={isLast ? onApproveTool : undefined}
                  approvedTools={approvedTools}
                  isExternal={isLast ? isExternal : undefined}
                />
              );
            }
          }
        })}
      </div>
    </div>
  );
}
