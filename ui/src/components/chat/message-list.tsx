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
import { INTERACTIVE_TOOLS } from "@shared/tools";

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
  planChildId?: string;
  planChildName?: string;
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
  planChildId,
  planChildName,
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

  // Detect cross-group interactive tool resolutions.
  // When an interactive tool_use is the last entry in one group and its
  // tool_result (with resolution) is in the next activity group, bridge them.
  const crossGroupResolution = new Map<number, "approved" | "dismissed" | "feedback">();
  const skipLeadingResultGroups = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const curr = items[i];
    if (curr.kind !== "activity-group") continue;
    const lastAct = curr.activities[curr.activities.length - 1];
    if (lastAct?.activity !== "tool_use" || !INTERACTIVE_TOOLS.has(lastAct.tool || "")) continue;
    // Look ahead for matching tool_result in the next activity group
    for (let j = i + 1; j < items.length; j++) {
      const next = items[j];
      if (next.kind !== "activity-group") continue;
      const firstAct = next.activities[0];
      if (firstAct?.activity === "tool_result" && firstAct.resolution) {
        crossGroupResolution.set(i, firstAct.resolution!);
        skipLeadingResultGroups.add(j);
      }
      break;
    }
  }

  // Show thinking dots whenever the instance is processing — either from
  // client-side state (showThinking() on send) or server-side status (covers
  // external sessions and fallback). No lastItemKind check — dots stay visible
  // even during text streaming to avoid flicker between tool calls.
  const showThinking = !!showThinkingIndicator || !!isProcessing || instanceStatus === "processing";

  // Pre-process items into render elements, merging consecutive activity-groups
  // into a single visual container with a shared "Tool calls" label.
  // Also inserts "Response" dividers when claude text follows tool calls.
  const renderElements: React.ReactNode[] = [];
  let lastRenderedKind: string | null = null; // "tool-container" | item.kind
  let i = 0;
  while (i < items.length) {
    const item = items[i];

    if (item.kind === "activity-group") {
      // Collect consecutive activity-groups into one run
      const runStart = i;
      const runGroups: Array<{ item: ChatItem & { kind: "activity-group" }; index: number }> = [];
      while (i < items.length && items[i].kind === "activity-group") {
        runGroups.push({
          item: items[i] as ChatItem & { kind: "activity-group" },
          index: i,
        });
        i++;
      }

      // Count total tool_use entries across all groups in this run
      const totalToolUses = runGroups.reduce(
        (sum, { item: g }) => sum + g.activities.filter((a) => a.activity === "tool_use").length,
        0,
      );

      renderElements.push(
        <div
          key={`tool-container-${runStart}`}
          className="rounded-lg border border-border/60 bg-surface/40"
        >
          {totalToolUses > 0 && (
            <div className="px-3 pt-2.5 pb-1">
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted/50">
                Tool call{totalToolUses > 1 ? `s (${totalToolUses})` : ""}
              </span>
            </div>
          )}
          <div className="flex flex-col px-1 pb-1.5">
            {runGroups.map(({ item: g, index: idx }) => {
              const isLast = idx === lastActivityGroupIndex;
              return (
                <ActivityGroup
                  key={idx}
                  activities={g.activities}
                  onSendMessage={isLast ? onSendMessage : undefined}
                  isInteractive={isLast ? isInteractive : undefined}
                  onApproveTool={isLast ? onApproveTool : undefined}
                  approvedTools={approvedTools}
                  isExternal={isLast ? isExternal : undefined}
                  trailingResolution={crossGroupResolution.get(idx)}
                  skipLeadingResult={skipLeadingResultGroups.has(idx)}
                  planChildId={planChildId}
                  planChildName={planChildName}
                />
              );
            })}
          </div>
        </div>,
      );
      lastRenderedKind = "tool-container";
    } else {
      // Insert a "Response" divider when a claude message follows tool calls
      if (item.kind === "claude" && lastRenderedKind === "tool-container") {
        // Compute duration from the most recent user message in this turn
        let durationLabel = "";
        for (let j = i - 1; j >= 0; j--) {
          if (items[j].kind === "user") {
            const userTs = (items[j] as ChatItem & { kind: "user" }).timestamp;
            if (userTs && item.timestamp) {
              const seconds = Math.round((item.timestamp - userTs) / 1000);
              if (seconds >= 1) {
                durationLabel =
                  seconds >= 60
                    ? ` · ${Math.floor(seconds / 60)}m ${seconds % 60}s`
                    : ` · ${seconds}s`;
              }
            }
            break;
          }
        }
        renderElements.push(
          <div key={`response-divider-${i}`} className="my-1 flex items-center gap-3">
            <span className="h-px flex-1 bg-border/50" />
            <span className="rounded-full border border-border/60 bg-bg px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted/60">
              Response{durationLabel}
            </span>
            <span className="h-px flex-1 bg-border/50" />
          </div>,
        );
      }

      switch (item.kind) {
        case "user":
          renderElements.push(<UserMessage key={i} text={item.text} timestamp={item.timestamp} />);
          break;
        case "claude":
          renderElements.push(
            <ClaudeMessage
              key={i}
              text={item.text}
              timestamp={item.timestamp}
              isLast={i === lastClaudeIndex}
            />,
          );
          break;
        case "system":
          renderElements.push(<SystemMessage key={i} text={item.text} isError={item.isError} />);
          break;
        case "thinking-block":
          renderElements.push(<ThinkingBlock key={i} text={item.text} />);
          break;
        case "agent-transcript":
          renderElements.push(<AgentTranscript key={i} title={item.title} result={item.result} />);
          break;
      }
      lastRenderedKind = item.kind;
      i++;
    }
  }

  return (
    <div ref={ref} className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
        {renderElements}
        {showThinking && <ThinkingIndicator />}
      </div>
    </div>
  );
}
