import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { MarkdownContent } from "./markdown-content";
import { MessageHoverToolbar } from "./message-hover-toolbar";
import { formatTimestamp } from "../../lib/utils";
import { GitBranchPlus } from "lucide-react";
import { useMessageRelay } from "@/components/chat/message-relay-context";

interface AgentMessageProps {
  text: string;
  timestamp?: number;
  anchorIndex?: number;
}

function SelectionSpinOffPopover({ rect, onSpinOff }: { rect: DOMRect; onSpinOff: () => void }) {
  return createPortal(
    <button
      type="button"
      data-selection-spin-off
      onMouseDown={(e) => {
        e.preventDefault();
        onSpinOff();
      }}
      className="fixed z-50 flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[0.75rem] font-medium text-text shadow-lg transition-colors hover:bg-surface-hover"
      style={{
        left: rect.left + rect.width / 2,
        top: rect.top - 8,
        transform: "translate(-50%, -100%)",
      }}
    >
      <GitBranchPlus size={13} className="text-muted" />
      Spin off selection
    </button>,
    document.body,
  );
}

export function AgentMessage({ text, timestamp, anchorIndex }: AgentMessageProps) {
  const relay = useMessageRelay();
  const contentRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [topVisible, setTopVisible] = useState(true);
  const [selectionPopover, setSelectionPopover] = useState<{
    text: string;
    rect: DOMRect;
  } | null>(null);

  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(([entry]) => setTopVisible(entry.isIntersecting), {
      threshold: 0,
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Dismiss the selection popover on scroll, but tolerate small scroll
  // movements (≤ 12px) so the user can nudge the viewport without losing the
  // popover before they can click it.
  useEffect(() => {
    if (!selectionPopover) return;
    let startY: number | null = null;
    const SCROLL_THRESHOLD = 12;
    const onScroll = () => {
      if (startY === null) {
        startY = window.scrollY;
        return;
      }
      if (Math.abs(window.scrollY - startY) > SCROLL_THRESHOLD) {
        setSelectionPopover(null);
      }
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [selectionPopover]);

  // Track whether a dismiss just happened so the subsequent mouseup from the
  // same click doesn't immediately re-show the popover (the browser selection
  // may not be collapsed yet when mouseup fires).
  const dismissedRef = useRef(false);

  useEffect(() => {
    if (!selectionPopover) return;
    const handler = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.("[data-selection-spin-off]")) return;
      dismissedRef.current = true;
      setSelectionPopover(null);
      // Reset after the mouseup from this same click has had a chance to fire.
      requestAnimationFrame(() => {
        dismissedRef.current = false;
      });
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [selectionPopover]);

  // Also clear the popover when the selection itself is removed (e.g. Escape,
  // clicking into an input, programmatic deselect).
  useEffect(() => {
    if (!selectionPopover) return;
    const onSelectionChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        setSelectionPopover(null);
      }
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [selectionPopover]);

  const handleSelectionMouseUp = useCallback(() => {
    // If a dismiss mousedown just fired, skip — the selection may linger
    // briefly and we don't want to re-show the popover.
    if (dismissedRef.current) return;

    if (!relay) {
      setSelectionPopover(null);
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      setSelectionPopover(null);
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText || selectedText.length < 3) {
      setSelectionPopover(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!contentRef.current?.contains(range.commonAncestorContainer)) {
      setSelectionPopover(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      setSelectionPopover(null);
      return;
    }

    setSelectionPopover({ text: selectedText, rect });
  }, [relay]);

  const handleSpinOffSelection = useCallback(() => {
    if (!selectionPopover) return;
    relay?.onSpinOff({
      anchorIndex,
      selectedText: selectionPopover.text,
    });
    setSelectionPopover(null);
    window.getSelection()?.removeAllRanges();
  }, [anchorIndex, relay, selectionPopover]);

  return (
    <div
      className="relative flex min-w-0 flex-col gap-1.5"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseUp={handleSelectionMouseUp}
    >
      {/* Sentinel to detect if the top of the message is in view */}
      <div ref={topSentinelRef} className="pointer-events-none absolute top-0 h-px w-full" />

      {topVisible && (
        <MessageHoverToolbar
          text={text}
          visible={hovered}
          position="top"
          anchorIndex={anchorIndex}
        />
      )}

      <div className="min-w-0 overflow-hidden px-1 py-0.5 text-sm leading-relaxed text-text/80">
        <div
          ref={contentRef}
          className="relative min-w-0 overflow-hidden transition-[max-height] duration-200"
        >
          <MarkdownContent text={text} />
        </div>
      </div>

      {!topVisible && (
        <MessageHoverToolbar
          text={text}
          visible={hovered}
          position="bottom"
          anchorIndex={anchorIndex}
        />
      )}

      {timestamp && (
        <span className="px-1 text-[10px] text-muted/45">{formatTimestamp(timestamp)}</span>
      )}

      {selectionPopover && (
        <SelectionSpinOffPopover rect={selectionPopover.rect} onSpinOff={handleSpinOffSelection} />
      )}
    </div>
  );
}
