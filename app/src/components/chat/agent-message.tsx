import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { MarkdownContent } from "./markdown-content";
import { MessageHoverToolbar } from "./message-hover-toolbar";
import { formatTimestamp } from "../../lib/utils";
import { CornerDownLeft, GitBranchPlus, OctagonX } from "lucide-react";
import { useMessageRelay } from "@/components/chat/message-relay-context";
import { Textarea } from "@/components/ui/input";
import { useTextSelection } from "@/hooks/use-text-selection";

interface AgentMessageProps {
  text: string;
  timestamp?: number;
  anchorIndex?: number;
  aborted?: boolean;
}

function SelectionReplyPopover({
  rect,
  value,
  onChange,
  onConfirm,
  onSpinOff,
  onDismiss,
}: {
  rect: DOMRect;
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onSpinOff: () => void;
  onDismiss: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<"top" | "bottom">("top");
  const updatePlacement = useCallback(() => {
    const popoverHeight = popoverRef.current?.offsetHeight ?? 0;
    const gap = 8;
    const topY = rect.top - gap - popoverHeight;
    setPlacement(topY < 8 ? "bottom" : "top");
  }, [rect]);

  useEffect(() => {
    updatePlacement();

    const popover = popoverRef.current;
    const resizeObserver =
      popover && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updatePlacement())
        : null;
    if (popover && resizeObserver) {
      resizeObserver.observe(popover);
    }

    window.addEventListener("resize", updatePlacement);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePlacement);
    };
  }, [updatePlacement]);

  return createPortal(
    <div
      data-selection-reply-popover
      ref={popoverRef}
      className="fixed z-50"
      style={{
        left: rect.left + rect.width / 2,
        top: placement === "top" ? rect.top - 8 : rect.bottom + 8,
        transform: placement === "top" ? "translate(-50%, -100%)" : "translate(-50%, 0)",
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 6 }}
        animate={{
          opacity: 1,
          scale: 1,
          y: 0,
          transition: { duration: 0.18, delay: 0.12, ease: [0.22, 1, 0.36, 1] },
        }}
        exit={{
          opacity: 0,
          scale: 0.92,
          y: placement === "top" ? 6 : -6,
          transition: { duration: 0.12, ease: [0.22, 1, 0.36, 1] },
        }}
        className="flex min-w-[280px] max-w-[min(32rem,calc(100vw-1rem))] items-center gap-2 rounded-xl border border-border bg-surface px-2 py-2 text-[0.75rem] shadow-lg"
        style={{ transformOrigin: placement === "top" ? "bottom center" : "top center" }}
      >
        <Textarea
          ref={inputRef}
          inputSize="sm"
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Reply to selection..."
          className="min-w-0 flex-1 resize-none overflow-hidden border-border/80 bg-bg shadow-none [field-sizing:content]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onConfirm();
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onDismiss();
            }
          }}
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onConfirm}
          disabled={!value.trim()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-accent text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Add inline reply"
          title="Add reply"
        >
          <CornerDownLeft size={14} />
        </button>
        <button
          type="button"
          data-selection-spin-off
          onMouseDown={(e) => {
            e.preventDefault();
            onSpinOff();
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text"
          aria-label="Spin off selection"
          title="Spin off selection"
        >
          <GitBranchPlus size={14} />
        </button>
      </motion.div>
    </div>,
    document.body,
  );
}

export function AgentMessage({ text, timestamp, anchorIndex, aborted }: AgentMessageProps) {
  const relay = useMessageRelay();
  const contentRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [topVisible, setTopVisible] = useState(true);
  const [reply, setReply] = useState("");

  const { selection: textSelection, clear: clearSelection } = useTextSelection(contentRef, {
    minLength: 3,
    popoverSelector: "[data-selection-reply-popover]",
  });

  const prevSelectionTextRef = useRef<string | null>(null);
  useEffect(() => {
    const currentSelText = textSelection?.text ?? null;
    if (currentSelText === prevSelectionTextRef.current) return;
    prevSelectionTextRef.current = currentSelText;
    setReply("");
  }, [textSelection?.text]);

  // Compute highlight overlay rects from the saved selection range,
  // positioned relative to the content container.
  const highlightRects = useMemo(() => {
    if (!textSelection?.range || !contentRef.current) return [];
    const container = contentRef.current.getBoundingClientRect();
    try {
      return Array.from(textSelection.range.getClientRects()).map((r) => ({
        left: r.left - container.left,
        top: r.top - container.top,
        width: r.width,
        height: r.height,
      }));
    } catch {
      return [];
    }
  }, [textSelection]);

  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(([entry]) => setTopVisible(entry.isIntersecting), {
      threshold: 0,
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const handleConfirmInlineReply = useCallback(() => {
    if (!textSelection || !relay) return;
    const trimmedReply = reply.trim();
    if (!trimmedReply) return;
    relay.onInlineReply({
      anchorIndex,
      selectedText: textSelection.text,
      reply: trimmedReply,
    });
    clearSelection();
  }, [anchorIndex, relay, textSelection, reply, clearSelection]);

  const handleSpinOffSelection = useCallback(() => {
    if (!textSelection) return;
    relay?.onSpinOff({
      anchorIndex,
      selectedText: textSelection.text,
    });
    clearSelection();
  }, [anchorIndex, relay, textSelection, clearSelection]);

  return (
    <div
      className="relative flex min-w-0 flex-col gap-1.5"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
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

      {/* max-[768px]:text-[16px] — mobile message text matches the composer's
          fixed 16px (anti-zoom) size, so a draft doesn't shrink when sent. */}
      <div className="min-w-0 overflow-hidden px-1 py-0.5 text-sm leading-relaxed text-text/80 max-[768px]:text-[16px]">
        <div
          ref={contentRef}
          className="relative min-w-0 overflow-hidden transition-[max-height] duration-200"
        >
          <MarkdownContent text={text} />
          {/* Custom highlight overlay — preserves visual highlight when input is focused */}
          {textSelection?.range && highlightRects.length > 0 && (
            <div className="pointer-events-none absolute inset-0">
              {highlightRects.map((r, i) => (
                <div
                  key={i}
                  className="absolute rounded-[3px] bg-accent/20"
                  style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
                />
              ))}
            </div>
          )}
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

      {(timestamp || aborted) && (
        <div className="flex items-center gap-2 px-1">
          {aborted && (
            <span className="inline-flex items-center gap-1 text-[0.625rem] text-muted/60">
              <OctagonX size={10} />
              Cancelled
            </span>
          )}
          {timestamp && (
            <span className="text-[0.625rem] text-muted/45">{formatTimestamp(timestamp)}</span>
          )}
        </div>
      )}

      <AnimatePresence>
        {textSelection && (
          <SelectionReplyPopover
            key="selection-reply"
            rect={textSelection.rect}
            value={reply}
            onChange={setReply}
            onConfirm={handleConfirmInlineReply}
            onSpinOff={handleSpinOffSelection}
            onDismiss={clearSelection}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
