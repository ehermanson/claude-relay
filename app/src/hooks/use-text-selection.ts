import { useState, useEffect, useCallback, useRef } from "react";
import type { RefObject } from "react";

export interface TextSelection {
  text: string;
  rect: DOMRect;
  range: Range;
}

/**
 * Tracks text selection within a container element, handling edge cases:
 * - Drag selections: suppresses evaluation while mouse is held down
 * - Double/triple-click: evaluates on mouseup after browser finalizes selection
 * - Keyboard selection: evaluates on debounced `selectionchange` when mouse is idle
 * - Popover interaction: skips dismiss when focus moves to a popover element
 * - Outside-click dismiss: clears selection on mousedown outside container & popover
 * - Scroll dismiss: clears after scrolling past a small threshold
 */
export function useTextSelection(
  containerRef: RefObject<HTMLElement | null>,
  opts?: { minLength?: number; popoverSelector?: string; mouseSettleMs?: number },
): { selection: TextSelection | null; clear: () => void } {
  const minLength = opts?.minLength ?? 3;
  const popoverSelector = opts?.popoverSelector ?? "[data-selection-reply-popover]";
  const mouseSettleMs = opts?.mouseSettleMs ?? 80;

  const [selection, setSelection] = useState<TextSelection | null>(null);
  const mouseDownRef = useRef(false);
  const mouseDownInPopoverRef = useRef(false);
  const mouseDownInContainerRef = useRef(false);
  const mouseSettleTimerRef = useRef<number | null>(null);
  const selectionRef = useRef<TextSelection | null>(null);
  selectionRef.current = selection;

  const cancelMouseSettle = useCallback(() => {
    if (mouseSettleTimerRef.current !== null) {
      window.clearTimeout(mouseSettleTimerRef.current);
      mouseSettleTimerRef.current = null;
    }
  }, []);

  const evaluate = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setSelection(null);
      return;
    }

    const selectedText = sel.toString().trim();
    if (!selectedText || selectedText.length < minLength) {
      setSelection(null);
      return;
    }

    const range = sel.getRangeAt(0);
    if (!containerRef.current?.contains(range.commonAncestorContainer)) {
      setSelection(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      setSelection(null);
      return;
    }

    const savedRange = range.cloneRange();
    setSelection((current) =>
      current?.text === selectedText
        ? { ...current, rect }
        : { text: selectedText, rect, range: savedRange },
    );
  }, [containerRef, minLength]);

  const clear = useCallback(() => {
    cancelMouseSettle();
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }, [cancelMouseSettle]);

  // ── Mouse tracking: suppress selectionchange during drag ──
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      mouseDownRef.current = true;
      cancelMouseSettle();

      const inPopover = !!target?.closest?.(popoverSelector);
      const inContainer = !!(target && containerRef.current?.contains(target));
      mouseDownInPopoverRef.current = inPopover;
      mouseDownInContainerRef.current = inContainer;

      // Never dismiss when clicking inside the popover itself.
      if (!selectionRef.current) return;
      if (inPopover) return;

      // Let clicks inside the content area complete their native selection flow.
      // Clearing here races against browser multi-click expansion.
      if (inContainer) return;

      setSelection(null);
      window.getSelection()?.removeAllRanges();
    };

    const onMouseUp = () => {
      mouseDownRef.current = false;

      // If the click started inside the popover, don't interfere.
      // Using a ref from mousedown avoids the race where React hasn't
      // yet unmounted the popover (batched state) so document.activeElement
      // still points at the popover input.
      if (mouseDownInPopoverRef.current) {
        mouseDownInPopoverRef.current = false;
        return;
      }

      const startedInContainer = mouseDownInContainerRef.current;
      mouseDownInContainerRef.current = false;

      // Give double/triple-click selection one extra beat to settle before
      // opening or repositioning the popover.
      cancelMouseSettle();
      mouseSettleTimerRef.current = window.setTimeout(() => {
        mouseSettleTimerRef.current = null;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
          if (startedInContainer || selectionRef.current) {
            setSelection(null);
          }
          return;
        }
        evaluate();
      }, mouseSettleMs);
    };

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [cancelMouseSettle, containerRef, evaluate, mouseSettleMs, popoverSelector]);

  // ── selectionchange: catches keyboard selection and programmatic changes ──
  useEffect(() => {
    let timer = 0;
    const onChange = () => {
      // Skip during mouse drag — mouseup handler will evaluate
      if (mouseDownRef.current) return;

      // Don't interfere while user is in the popover
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest(popoverSelector)) return;

      clearTimeout(timer);
      timer = window.setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
          setSelection(null);
          return;
        }
        evaluate();
      }, 20);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
    };
  }, [evaluate, popoverSelector]);

  // ── Scroll dismiss with small threshold ──
  useEffect(() => {
    let startY: number | null = null;
    const SCROLL_THRESHOLD = 12;
    const onScroll = () => {
      if (!selectionRef.current) {
        startY = null;
        return;
      }
      if (startY === null) {
        startY = window.scrollY;
        return;
      }
      if (Math.abs(window.scrollY - startY) > SCROLL_THRESHOLD) {
        setSelection(null);
        startY = null;
      }
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, []);

  useEffect(() => cancelMouseSettle, [cancelMouseSettle]);

  return { selection, clear };
}
