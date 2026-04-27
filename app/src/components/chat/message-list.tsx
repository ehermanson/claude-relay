import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { AgentTranscript } from "@/components/chat/agent-transcript";
import { ChatTOC } from "@/components/chat/chat-toc";
import { AgentMessage } from "@/components/chat/agent-message";
import { CompactBoundary } from "@/components/chat/compact-boundary";
import { LiveStatusStrip } from "@/components/chat/live-status-strip";
import { ResponseDivider } from "@/components/chat/response-divider";
import { SystemMessage } from "@/components/chat/system-message";
import { ThinkingBlock } from "@/components/chat/thinking-block";
import { ToolContainer } from "@/components/chat/tool-container";
import { UserMessage } from "@/components/chat/user-message";
import { buildRows, estimateRowHeight } from "@/components/chat/build-rows";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { ChatItem, LiveActivity, RenderRow, UserRow } from "@/lib/chat-types";
import type { UserInputAnswer } from "@shared/types";
import { computeBubbleShrinkwrap, onFontReady } from "@/lib/pretext";

// Always keep the last N rows non-virtualized so the bottom of the chat
// is real DOM with accurate measurements — reduces virtualizer churn
// near the scroll edge and makes stick-to-bottom more reliable.
const ALWAYS_UNVIRTUALIZED_TAIL_ROWS = 8;

// ── Component ────────────────────────────────────────────────────────

interface MessageListProps {
  items: ChatItem[];
  searchFocus?: {
    query: string;
    snippet?: string;
  } | null;
  isProcessing?: boolean;
  showThinkingIndicator?: boolean;
  instanceStatus?: string;
  lastActivity?: LiveActivity | null;
  processingStartedAt?: number | null;
  onSendMessage?: (text: string) => void;
  onAnswerUserInput?: (requestId: string, answers: Record<string, UserInputAnswer>) => void;
  isInteractive?: boolean;
  onApproveTool?: (tool: string) => void;
  approvedTools?: Set<string>;
  isExternal?: boolean;
  pendingInteraction?: boolean;
  planChildId?: string;
  planChildName?: string;
  onInterruptAndSend?: () => void;
}

export function MessageList({
  items,
  searchFocus,
  isProcessing,
  showThinkingIndicator,
  instanceStatus,
  lastActivity,
  processingStartedAt,
  onSendMessage,
  onAnswerUserInput,
  isInteractive,
  onApproveTool,
  approvedTools,
  isExternal,
  pendingInteraction,
  planChildId,
  planChildName,
  onInterruptAndSend,
}: MessageListProps) {
  const {
    ref: scrollRef,
    forceStickToBottom,
    onContentChange,
    showScrollToBottom,
  } = useAutoScroll<HTMLDivElement>();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const [activeSearchRowId, setActiveSearchRowId] = useState<string | null>(null);
  const consumedSearchFocusRef = useRef<string | null>(null);

  // ── Container width tracking (for pretext layout) ────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const containerWidthRef = useRef(720); // default max-w-3xl - px-6
  const [, setFontTick] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    containerWidthRef.current = el.clientWidth;
    const observer = new ResizeObserver(([entry]) => {
      containerWidthRef.current = entry.contentRect.width;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => onFontReady(() => setFontTick((t) => t + 1)), []);

  // ── Build render rows ────────────────────────────────────────────
  // Queued user messages are rendered in a dedicated section at the bottom,
  // not interleaved with the live stream — otherwise they get buried as the
  // agent emits assistant text and tool calls.
  const allRows = useMemo(() => buildRows(items), [items]);
  const { rows, queuedRows } = useMemo(() => {
    const main: RenderRow[] = [];
    const queued: UserRow[] = [];
    for (const r of allRows) {
      if (r.kind === "user" && r.queued) queued.push(r);
      else main.push(r);
    }
    return { rows: main, queuedRows: queued };
  }, [allRows]);
  const searchTargetIndex = useMemo(() => {
    if (!searchFocus?.query) return -1;
    return findSearchTargetRowIndex(rows, searchFocus);
  }, [rows, searchFocus]);

  // ── Hybrid split ─────────────────────────────────────────────────
  const firstUnvirtualizedRowIndex = useMemo(() => {
    const tailStart = Math.max(rows.length - ALWAYS_UNVIRTUALIZED_TAIL_ROWS, 0);
    if (!isProcessing) return tailStart;
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
    estimateSize: (i) => (rows[i] ? estimateRowHeight(rows[i], containerWidthRef.current) : 96),
    gap: 16,
    overscan: isMobile ? 20 : 8,
  });

  useEffect(() => {
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
      // On mobile, preserving momentum is more important than anchor-perfect
      // compensation while older virtualized rows mount above the viewport.
      if (isMobile) return false;
      // Only adjust scroll when the resized item is fully above the viewport.
      // This keeps the viewport stable when visible items change size
      // (e.g. user expanding/collapsing a tool call) — the content just
      // grows/shrinks in place without shifting the scroll position.
      const scrollOffset = instance.scrollOffset ?? 0;
      return item.start + item.size < scrollOffset;
    };
    return () => {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
    };
  }, [isMobile, rowVirtualizer]);

  // ── Scroll management ────────────────────────────────────────────
  const hadItems = useRef(false);
  useEffect(() => {
    if (items.length > 0 && !hadItems.current) {
      hadItems.current = true;
      forceStickToBottom();
    } else if (items.length === 0) {
      hadItems.current = false;
    } else {
      onContentChange();
    }
  }, [items, forceStickToBottom, onContentChange]);

  // ── Thinking indicator ───────────────────────────────────────────
  const showThinking =
    !pendingInteraction &&
    (!!showThinkingIndicator || !!isProcessing || instanceStatus === "processing");
  const lastUserMessage = [...items]
    .reverse()
    .find(
      (item): item is Extract<ChatItem, { kind: "user" }> => item.kind === "user" && !item.queued,
    );
  const isCompactingTurn =
    showThinking && !!lastUserMessage && /^\s*\/compact\b/i.test(lastUserMessage.text.trim());

  // ── TOC scroll-to-row handler ─────────────────────────────────
  const handleScrollToRow = useCallback(
    (rowIndex: number) => {
      if (rowIndex < virtualizedRowCount) {
        // Row is in the virtualized section — use the virtualizer to scroll
        rowVirtualizer.scrollToIndex(rowIndex, { align: "start", behavior: "smooth" });
      } else {
        // Row is in the non-virtualized tail — find the DOM element by row id
        const row = rows[rowIndex];
        if (row) {
          const el = scrollRef.current?.querySelector(`[data-row-id="${row.id}"]`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      }
    },
    [virtualizedRowCount, rowVirtualizer, rows, scrollRef],
  );

  useEffect(() => {
    if (!searchFocus?.query) {
      consumedSearchFocusRef.current = null;
      setActiveSearchRowId(null);
      return;
    }
    if (searchTargetIndex < 0) return;

    const row = rows[searchTargetIndex];
    if (!row) return;

    const key = `${searchFocus.query}\n${searchFocus.snippet ?? ""}\n${row.id}`;
    if (consumedSearchFocusRef.current === key) return;
    consumedSearchFocusRef.current = key;

    const timer = window.setTimeout(() => {
      handleScrollToRow(searchTargetIndex);
      setActiveSearchRowId(row.id);
    }, 80);

    return () => window.clearTimeout(timer);
  }, [handleScrollToRow, rows, searchFocus, searchTargetIndex]);

  useEffect(() => {
    if (!activeSearchRowId) return;
    const timer = window.setTimeout(() => setActiveSearchRowId(null), 3000);
    return () => window.clearTimeout(timer);
  }, [activeSearchRowId]);

  // ── Row renderer ─────────────────────────────────────────────────
  const renderRow = (row: RenderRow, rowIndex?: number) => {
    switch (row.kind) {
      case "user":
        return (
          <UserMessage
            text={row.text}
            timestamp={row.timestamp}
            shrinkwrapWidth={computeBubbleShrinkwrap(row.text, containerWidthRef.current)}
            queued={row.queued}
            onInterruptAndSend={row.queued ? onInterruptAndSend : undefined}
          />
        );
      case "assistant": {
        // row.id is "assistant-${chatItemIndex}" — extract the original ChatItem
        // index so the server can anchor the spin-off excerpt correctly (the
        // virtualizer rowIndex includes dividers/tool-containers and would be wrong).
        const origIdx = parseInt(row.id.split("-")[1], 10);
        return (
          <AgentMessage
            text={row.text}
            timestamp={row.timestamp}
            anchorIndex={Number.isFinite(origIdx) ? origIdx : rowIndex}
          />
        );
      }
      case "system":
        return <SystemMessage text={row.text} isError={row.isError} />;
      case "compact-boundary":
        return <CompactBoundary timestamp={row.timestamp} />;
      case "thinking-block":
        return <ThinkingBlock text={row.text} />;
      case "agent-transcript":
        return <AgentTranscript title={row.title} result={row.result} />;
      case "response-divider":
        return <ResponseDivider durationLabel={row.durationLabel} />;
      case "tool-container":
        return (
          <ToolContainer
            groups={row.groups}
            allActivities={row.allActivities}
            onSendMessage={onSendMessage}
            onAnswerUserInput={onAnswerUserInput}
            isInteractive={isInteractive}
            onApproveTool={onApproveTool}
            approvedTools={approvedTools}
            isExternal={isExternal}
            planChildId={planChildId}
            planChildName={planChildName}
          />
        );
    }
  };

  // ── Render ───────────────────────────────────────────────────────
  const virtualRows = rowVirtualizer.getVirtualItems();
  const nonVirtualizedRows = rows.slice(virtualizedRowCount);
  const hasVirtual = virtualizedRowCount > 0;
  const hasNonVirtual = nonVirtualizedRows.length > 0 || showThinking || queuedRows.length > 0;

  return (
    <div className="relative flex min-h-0 flex-1">
      <ChatTOC rows={rows} onScrollToRow={handleScrollToRow} />
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div
          ref={containerRef}
          className="mx-auto max-w-3xl px-6 py-6 max-[768px]:px-3 max-[768px]:py-3"
        >
          {/* Virtualized section — absolute-positioned items in a sized container */}
          {hasVirtual && (
            <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
              {virtualRows.map((virtualRow) => (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  data-row-id={rows[virtualRow.index]?.id}
                  ref={rowVirtualizer.measureElement}
                  className={`absolute left-0 top-0 flex w-full flex-col rounded-xl transition-colors duration-700 ${
                    rows[virtualRow.index]?.id === activeSearchRowId
                      ? "bg-accent/10 ring-1 ring-accent/30"
                      : ""
                  }`}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {renderRow(rows[virtualRow.index], virtualRow.index)}
                </div>
              ))}
            </div>
          )}

          {/* Non-virtualized section — current turn during processing */}
          {hasNonVirtual && (
            <div className={`flex flex-col gap-4${hasVirtual ? " mt-4" : ""}`}>
              {nonVirtualizedRows.map((row, i) => (
                <div
                  key={row.id}
                  data-row-id={row.id}
                  className={`flex animate-fade-in flex-col rounded-xl transition-colors duration-700 ${
                    row.id === activeSearchRowId ? "bg-accent/10 ring-1 ring-accent/30" : ""
                  }`}
                >
                  {renderRow(row, virtualizedRowCount + i)}
                </div>
              ))}
              {showThinking && (
                <LiveStatusStrip
                  activity={lastActivity ?? null}
                  processingStartedAt={processingStartedAt ?? null}
                  isProcessing={!!isProcessing}
                  instanceStatus={instanceStatus}
                  isCompacting={isCompactingTurn}
                />
              )}
              {queuedRows.length > 0 && (
                <div className="mt-2 flex flex-col gap-3 border-t border-dashed border-border/30 pt-3">
                  <div className="px-1 text-[10px] uppercase tracking-wider text-muted/50">
                    Queued
                    {queuedRows.length > 1 ? ` · ${queuedRows.length}` : ""}
                  </div>
                  {queuedRows.map((row) => (
                    <div
                      key={row.id}
                      data-row-id={row.id}
                      className="flex animate-fade-in flex-col"
                    >
                      {renderRow(row)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-[1px] bottom-0 h-10 bg-gradient-to-t from-bg to-transparent" />

      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-6">
        <AnimatePresence>
          {showScrollToBottom && (
            <motion.button
              type="button"
              onClick={() => forceStickToBottom(true)}
              aria-label="Scroll to bottom"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ type: "spring", duration: 0.5, bounce: 0.3 }}
              className="glass pointer-events-auto inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[0.75rem] font-medium text-text-bright hover:brightness-110 active:scale-[0.97]"
            >
              <ArrowDown size={13} strokeWidth={2.5} />
              Jump to latest
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function findSearchTargetRowIndex(
  rows: RenderRow[],
  searchFocus: { query: string; snippet?: string },
): number {
  const snippetTerms = extractSnippetTerms(searchFocus.snippet);
  if (snippetTerms.length > 0) {
    const snippetMatch = findBestSearchRowIndex(rows, snippetTerms);
    if (snippetMatch >= 0) return snippetMatch;
  }

  const queryTerms = extractQueryTerms(searchFocus.query);
  if (queryTerms.length > 0) {
    return findBestSearchRowIndex(rows, queryTerms);
  }

  return -1;
}

function findBestSearchRowIndex(rows: RenderRow[], terms: string[]): number {
  let bestIndex = -1;
  let bestScore = 0;

  for (let i = 0; i < rows.length; i++) {
    const haystack = getSearchableRowText(rows[i]);
    if (!haystack) continue;
    const score = scoreSearchTerms(haystack, terms);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
      if (score >= terms.length * 4) break;
    }
  }

  return bestIndex;
}

function getSearchableRowText(row: RenderRow): string {
  switch (row.kind) {
    case "user":
    case "assistant":
    case "system":
    case "thinking-block":
      return normalizeSearchText(row.text);
    case "agent-transcript":
      return normalizeSearchText(`${row.title} ${row.result}`);
    default:
      return "";
  }
}

function extractSnippetTerms(snippet?: string): string[] {
  if (!snippet) return [];
  const plain = snippet
    .replace(/<mark>/gi, " ")
    .replace(/<\/mark>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&hellip;|…/g, " ");
  return tokenizeSearchText(plain, 3);
}

function extractQueryTerms(query: string): string[] {
  return tokenizeSearchText(query.replace(/\b(?:AND|OR|NOT|NEAR)\b/gi, " "), 2);
}

function tokenizeSearchText(text: string, minLength: number): string[] {
  const normalized = normalizeSearchText(text);
  if (!normalized) return [];
  return [...new Set(normalized.split(" ").filter((term) => term.length >= minLength))];
}

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function scoreSearchTerms(haystack: string, terms: string[]): number {
  let score = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) continue;
    score += haystack.includes(` ${term} `) ? 4 : 2;
  }
  return score;
}
