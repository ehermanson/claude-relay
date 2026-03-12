import { useMemo, useRef, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { UserMessage } from "./user-message";
import { ClaudeMessage } from "./claude-message";
import { SystemMessage } from "./system-message";
import { ThinkingBlock } from "./thinking-block";
import { LiveStatusStrip } from "./live-status-strip";
import { ActivityGroup } from "./activity-group";
import { AgentTranscript } from "./agent-transcript";
import { useAutoScroll } from "../../hooks/use-auto-scroll";
import type { ChatItem, LiveActivity } from "../../hooks/use-instance-messages";
import { INTERACTIVE_TOOLS } from "@shared/tools";
import type { ActivityMessage } from "@shared/types";

// ── Row types ────────────────────────────────────────────────────────

interface ToolGroupData {
  activities: ActivityMessage[];
  originalIndex: number;
  isLastActivityGroup: boolean;
  trailingResolution?: "approved" | "dismissed" | "feedback";
  skipLeadingResult?: boolean;
}

type RenderRow =
  | { id: string; kind: "user"; text: string; timestamp?: number }
  | {
      id: string;
      kind: "assistant";
      text: string;
      timestamp?: number;
      isLast: boolean;
    }
  | { id: string; kind: "system"; text: string; isError?: boolean }
  | { id: string; kind: "thinking-block"; text: string }
  | {
      id: string;
      kind: "agent-transcript";
      title: string;
      result: string;
      timestamp?: number;
    }
  | { id: string; kind: "response-divider"; durationLabel: string }
  | {
      id: string;
      kind: "tool-container";
      groups: ToolGroupData[];
      totalToolUses: number;
    };

// ── Build render rows from ChatItems ─────────────────────────────────

function buildRows(items: ChatItem[]): RenderRow[] {
  // Pre-compute last indices for interactivity
  let lastActivityGroupIndex = -1;
  let lastAssistantIndex = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (lastActivityGroupIndex === -1 && items[i].kind === "activity-group")
      lastActivityGroupIndex = i;
    if (lastAssistantIndex === -1 && items[i].kind === "assistant") lastAssistantIndex = i;
    if (lastActivityGroupIndex !== -1 && lastAssistantIndex !== -1) break;
  }

  // Detect cross-group interactive tool resolutions
  const crossGroupResolution = new Map<number, "approved" | "dismissed" | "feedback">();
  const skipLeadingResultGroups = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    const curr = items[i];
    if (curr.kind !== "activity-group") continue;
    const lastAct = curr.activities[curr.activities.length - 1];
    if (lastAct?.activity !== "tool_use" || !INTERACTIVE_TOOLS.has(lastAct.tool || "")) continue;
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

  const rows: RenderRow[] = [];
  let lastRenderedKind: string | null = null;
  let i = 0;

  while (i < items.length) {
    const item = items[i];

    if (item.kind === "activity-group") {
      // Collect consecutive activity-groups into one tool container
      const runStart = i;
      const groups: ToolGroupData[] = [];
      while (i < items.length && items[i].kind === "activity-group") {
        const g = items[i] as ChatItem & { kind: "activity-group" };
        groups.push({
          activities: g.activities,
          originalIndex: i,
          isLastActivityGroup: i === lastActivityGroupIndex,
          trailingResolution: crossGroupResolution.get(i),
          skipLeadingResult: skipLeadingResultGroups.has(i),
        });
        i++;
      }
      const totalToolUses = groups.reduce(
        (sum, g) => sum + g.activities.filter((a) => a.activity === "tool_use").length,
        0,
      );
      rows.push({
        id: `tools-${runStart}`,
        kind: "tool-container",
        groups,
        totalToolUses,
      });
      lastRenderedKind = "tool-container";
    } else {
      // Insert response divider when assistant text follows tool calls
      if (item.kind === "assistant" && lastRenderedKind === "tool-container") {
        let durationLabel = "";
        for (let j = i - 1; j >= 0; j--) {
          if (items[j].kind === "user") {
            const userTs = (items[j] as ChatItem & { kind: "user" }).timestamp;
            if (userTs && item.timestamp) {
              const seconds = Math.round((item.timestamp - userTs) / 1000);
              if (seconds >= 1) {
                durationLabel =
                  seconds >= 60
                    ? ` \u00b7 ${Math.floor(seconds / 60)}m ${seconds % 60}s`
                    : ` \u00b7 ${seconds}s`;
              }
            }
            break;
          }
        }
        rows.push({
          id: `divider-${i}`,
          kind: "response-divider",
          durationLabel,
        });
      }

      switch (item.kind) {
        case "user":
          rows.push({
            id: `user-${i}`,
            kind: "user",
            text: item.text,
            timestamp: item.timestamp,
          });
          break;
        case "assistant":
          rows.push({
            id: `assistant-${i}`,
            kind: "assistant",
            text: item.text,
            timestamp: item.timestamp,
            isLast: i === lastAssistantIndex,
          });
          break;
        case "system":
          rows.push({
            id: `system-${i}`,
            kind: "system",
            text: item.text,
            isError: item.isError,
          });
          break;
        case "thinking-block":
          rows.push({
            id: `thinking-${i}`,
            kind: "thinking-block",
            text: item.text,
          });
          break;
        case "agent-transcript":
          rows.push({
            id: `transcript-${i}`,
            kind: "agent-transcript",
            title: item.title,
            result: item.result,
            timestamp: item.timestamp,
          });
          break;
      }
      lastRenderedKind = item.kind;
      i++;
    }
  }

  return rows;
}

// ── Height estimation (corrected by measureElement after render) ──────

function estimateRowHeight(row: RenderRow): number {
  switch (row.kind) {
    case "user":
      return 72 + Math.ceil(row.text.length / 80) * 20;
    case "assistant":
      return Math.max(80, Math.min(500, 60 + Math.ceil(row.text.length / 60) * 20));
    case "system":
      return 44;
    case "thinking-block":
      return 60 + Math.ceil(row.text.length / 80) * 16;
    case "agent-transcript":
      return 80;
    case "response-divider":
      return 36;
    case "tool-container": {
      const activityCount = row.groups.reduce((s, g) => s + g.activities.length, 0);
      return 40 + activityCount * 40;
    }
  }
}

// ── Threshold for "near bottom" detection ────────────────────────────

const NEAR_BOTTOM_PX = 60;

// Always keep the last N rows non-virtualized so the bottom of the chat
// is real DOM with accurate measurements — reduces virtualizer churn
// near the scroll edge and makes stick-to-bottom more reliable.
const ALWAYS_UNVIRTUALIZED_TAIL_ROWS = 8;

// ── Component ────────────────────────────────────────────────────────

interface MessageListProps {
  items: ChatItem[];
  isProcessing?: boolean;
  showThinkingIndicator?: boolean;
  instanceStatus?: string;
  lastActivity?: LiveActivity | null;
  processingStartedAt?: number | null;
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
  lastActivity,
  processingStartedAt,
  onSendMessage,
  isInteractive,
  onApproveTool,
  approvedTools,
  isExternal,
  planChildId,
  planChildName,
}: MessageListProps) {
  const {
    ref: scrollRef,
    scrollToBottom,
    forceStickToBottom,
    onContentChange,
  } = useAutoScroll<HTMLDivElement>();

  // ── Build render rows ────────────────────────────────────────────
  const rows = useMemo(() => buildRows(items), [items]);

  // ── Hybrid split ─────────────────────────────────────────────────
  // Always keep the last N rows non-virtualized so the bottom of the
  // chat has real DOM measurements. During processing, extend that to
  // include the full current turn (from last user message onward).
  const firstUnvirtualizedRowIndex = useMemo(() => {
    const tailStart = Math.max(rows.length - ALWAYS_UNVIRTUALIZED_TAIL_ROWS, 0);
    if (!isProcessing) return tailStart;
    // Find the last user message to include the full current turn
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].kind === "user") return Math.min(i, tailStart);
    }
    return tailStart;
  }, [rows, isProcessing]);

  const virtualizedRowCount = Math.min(firstUnvirtualizedRowIndex, rows.length);

  // ── Virtualizer ──────────────────────────────────────────────────
  const rowVirtualizer = useVirtualizer({
    count: virtualizedRowCount,
    getScrollElement: () => scrollRef.current,
    getItemKey: (i) => rows[i]?.id ?? i,
    estimateSize: (i) => (rows[i] ? estimateRowHeight(rows[i]) : 96),
    gap: 16,
    overscan: 8,
  });

  // Prevent viewport jumping when items above the viewport resize.
  // Only adjust scroll position when NOT near the bottom.
  useEffect(() => {
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (_item, _delta, instance) => {
      const viewportHeight = instance.scrollRect?.height ?? 0;
      const scrollOffset = instance.scrollOffset ?? 0;
      const remainingDistance = instance.getTotalSize() - (scrollOffset + viewportHeight);
      return remainingDistance > NEAR_BOTTOM_PX;
    };
    return () => {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
    };
  }, [rowVirtualizer]);

  // ── Scroll management ────────────────────────────────────────────
  const hadItems = useRef(false);
  useEffect(() => {
    if (items.length > 0 && !hadItems.current) {
      hadItems.current = true;
      forceStickToBottom();
    } else if (items.length === 0) {
      hadItems.current = false;
    } else {
      scrollToBottom();
    }
  }, [items, forceStickToBottom, scrollToBottom]);

  // ── Thinking indicator ───────────────────────────────────────────
  const showThinking = !!showThinkingIndicator || !!isProcessing || instanceStatus === "processing";

  // ── Row renderer ─────────────────────────────────────────────────
  const renderRow = (row: RenderRow) => {
    switch (row.kind) {
      case "user":
        return <UserMessage text={row.text} timestamp={row.timestamp} />;
      case "assistant":
        return <ClaudeMessage text={row.text} timestamp={row.timestamp} isLast={row.isLast} />;
      case "system":
        return <SystemMessage text={row.text} isError={row.isError} />;
      case "thinking-block":
        return <ThinkingBlock text={row.text} />;
      case "agent-transcript":
        return <AgentTranscript title={row.title} result={row.result} />;
      case "response-divider":
        return (
          <div className="my-1 flex items-center gap-3">
            <span className="h-px flex-1 bg-border/50" />
            <span className="rounded-lg bg-bg px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-muted/80">
              Response{row.durationLabel}
            </span>
            <span className="h-px flex-1 bg-border/50" />
          </div>
        );
      case "tool-container":
        return (
          <div className="rounded-lg border border-border/60 bg-surface/40">
            {row.totalToolUses > 0 && (
              <div className="px-3 pt-2.5 pb-1">
                <span className="text-[10px] uppercase tracking-[0.12em] text-muted/50">
                  Tool call
                  {row.totalToolUses > 1 ? `s (${row.totalToolUses})` : ""}
                </span>
              </div>
            )}
            <div className="flex flex-col px-1 pb-1.5">
              {row.groups.map((g) => (
                <ActivityGroup
                  key={g.originalIndex}
                  activities={g.activities}
                  onSendMessage={g.isLastActivityGroup ? onSendMessage : undefined}
                  isInteractive={g.isLastActivityGroup ? isInteractive : undefined}
                  onApproveTool={g.isLastActivityGroup ? onApproveTool : undefined}
                  approvedTools={approvedTools}
                  isExternal={g.isLastActivityGroup ? isExternal : undefined}
                  trailingResolution={g.trailingResolution}
                  skipLeadingResult={g.skipLeadingResult}
                  planChildId={planChildId}
                  planChildName={planChildName}
                />
              ))}
            </div>
          </div>
        );
    }
  };

  // ── Render ───────────────────────────────────────────────────────
  const virtualRows = rowVirtualizer.getVirtualItems();
  const nonVirtualizedRows = rows.slice(virtualizedRowCount);
  const hasVirtual = virtualizedRowCount > 0;
  const hasNonVirtual = nonVirtualizedRows.length > 0 || showThinking;

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-6">
        {/* Virtualized section — absolute-positioned items in a sized container */}
        {hasVirtual && (
          <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
            {virtualRows.map((virtualRow) => (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                className="absolute left-0 top-0 flex w-full flex-col"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {renderRow(rows[virtualRow.index])}
              </div>
            ))}
          </div>
        )}

        {/* Non-virtualized section — current turn during processing */}
        {hasNonVirtual && (
          <div className={`flex flex-col gap-4${hasVirtual ? " mt-4" : ""}`}>
            {nonVirtualizedRows.map((row) => (
              <div key={row.id} className="flex animate-fade-in flex-col">
                {renderRow(row)}
              </div>
            ))}
            {showThinking && (
              <LiveStatusStrip
                activity={lastActivity ?? null}
                processingStartedAt={processingStartedAt ?? null}
                isProcessing={!!isProcessing}
                instanceStatus={instanceStatus}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
