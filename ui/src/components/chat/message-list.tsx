import { useEffect, useRef } from "react";
import { UserMessage } from "./user-message";
import { ClaudeMessage } from "./claude-message";
import { SystemMessage } from "./system-message";
import { ThinkingBlock } from "./thinking-block";
import { ThinkingIndicator } from "./thinking-indicator";
import { ActivityGroup } from "./activity-group";
import { AgentTranscript } from "./agent-transcript";
import { useAutoScroll } from "../../hooks/use-auto-scroll";
import type { ChatItem } from "../../hooks/use-instance-messages";

interface MessageListProps {
  items: ChatItem[];
  isProcessing?: boolean;
  showThinkingIndicator?: boolean;
  instanceStatus?: string;
  onSendMessage?: (text: string) => void;
  isInteractive?: boolean;
  onApproveTool?: (tool: string) => void;
  approvedTools?: Set<string>;
  isExternal?: boolean;
}

export function MessageList({
  items,
  isProcessing,
  showThinkingIndicator,
  instanceStatus,
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

  // Show thinking dots whenever the instance is processing — either from
  // client-side state (showThinking() on send) or server-side status (covers
  // external sessions and fallback). No lastItemKind check — dots stay visible
  // even during text streaming to avoid flicker between tool calls.
  const showThinking = !!showThinkingIndicator || !!isProcessing || instanceStatus === "processing";

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
            case "agent-transcript":
              return <AgentTranscript key={i} title={item.title} result={item.result} />;
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
        {showThinking && <ThinkingIndicator />}
      </div>
    </div>
  );
}
