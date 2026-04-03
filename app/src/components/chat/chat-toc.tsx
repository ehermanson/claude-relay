/**
 * Chat Table of Contents — floating button that opens a popup listing
 * user messages as navigation anchors for quick jumping in long chats.
 */

import { useState, useRef, useEffect, useMemo } from "react";
import { List, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { RenderRow } from "@/lib/chat-types";

interface ChatTOCProps {
  rows: RenderRow[];
  onScrollToRow: (rowIndex: number) => void;
}

function truncateText(text: string, maxLen: number): string {
  // Strip leading whitespace/newlines and take first line
  const firstLine = text.trimStart().split("\n")[0];
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen) + "\u2026";
}

export function ChatTOC({ rows, onScrollToRow }: ChatTOCProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Extract user message anchors with their row indices
  const anchors = useMemo(() => {
    const result: Array<{ rowIndex: number; text: string; timestamp?: number }> = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row.kind === "user") {
        result.push({ rowIndex: i, text: row.text, timestamp: row.timestamp });
      }
    }
    return result;
  }, [rows]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  // Don't show if fewer than 3 user messages
  if (anchors.length < 3) return null;

  return (
    <div className="absolute right-3 top-3 z-20">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Chat table of contents"
        className={`glass inline-flex items-center justify-center rounded-lg p-1.5 text-muted/70 transition-colors hover:text-text ${
          open ? "text-text" : ""
        }`}
      >
        {open ? <X size={14} strokeWidth={2} /> : <List size={14} strokeWidth={2} />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={popoverRef}
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute right-0 top-full mt-1.5 w-72 max-h-80 overflow-y-auto rounded-xl border border-border bg-surface shadow-lg"
          >
            <div className="flex flex-col p-1">
              {anchors.map((anchor) => (
                <button
                  key={anchor.rowIndex}
                  type="button"
                  onClick={() => {
                    onScrollToRow(anchor.rowIndex);
                    setOpen(false);
                  }}
                  className="flex rounded-md items-baseline gap-2 px-3 py-1.5 text-left transition-colors hover:bg-hover-highlight"
                >
                  <span className="min-w-0 truncate text-[12px] text-text/80">
                    {truncateText(anchor.text, 60)}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
