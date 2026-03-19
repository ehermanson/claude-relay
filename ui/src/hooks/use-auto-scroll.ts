import { useRef, useEffect, useCallback, useState } from "react";

const NEAR_BOTTOM_PX = 64;
const SHOW_SCROLL_TO_BOTTOM_PX = 500;
const FORCE_SCROLL_MAX_FRAMES = 48;
const FORCE_SCROLL_STABLE_FRAMES = 3;

export function useAutoScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const stickToBottom = useRef(true);
  const forceScrollRunId = useRef(0);
  const forceScrollUntil = useRef(0);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const showScrollToBottomRef = useRef(false);

  const setShowScrollToBottomIfChanged = useCallback((next: boolean) => {
    if (showScrollToBottomRef.current === next) return;
    showScrollToBottomRef.current = next;
    setShowScrollToBottom(next);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const cancelForcedScroll = useCallback(() => {
    forceScrollRunId.current += 1;
    forceScrollUntil.current = 0;
  }, []);

  // Force scroll to bottom — session switch / initial load / user click
  const forceStickToBottom = useCallback(
    (smooth?: boolean) => {
      stickToBottom.current = true;
      setShowScrollToBottomIfChanged(false);

      // Smooth scroll for user-initiated clicks — let the browser animate
      if (smooth) {
        const el = ref.current;
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        return;
      }

      const runId = forceScrollRunId.current + 1;
      forceScrollRunId.current = runId;
      forceScrollUntil.current = performance.now() + 1000;

      let lastScrollHeight = -1;
      let stableFrames = 0;
      let frames = 0;

      const settleToBottom = () => {
        if (forceScrollRunId.current !== runId) return;

        const el = ref.current;
        if (!el) return;

        scrollToBottom();

        const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
        const heightStable = Math.abs(el.scrollHeight - lastScrollHeight) <= 1;
        stableFrames = remaining <= 1 && heightStable ? stableFrames + 1 : 0;
        lastScrollHeight = el.scrollHeight;
        frames += 1;

        if (stableFrames >= FORCE_SCROLL_STABLE_FRAMES || frames >= FORCE_SCROLL_MAX_FRAMES) {
          if (forceScrollRunId.current === runId) {
            forceScrollUntil.current = 0;
          }
          return;
        }

        requestAnimationFrame(settleToBottom);
      };

      settleToBottom();
    },
    [scrollToBottom, setShowScrollToBottomIfChanged],
  );

  // Conditionally scroll — content changes while user is at bottom
  const onContentChange = useCallback(() => {
    if (stickToBottom.current) scrollToBottom();
  }, [scrollToBottom]);

  // Track user scroll intent
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastScrollTop = el.scrollTop;

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const remainingDistance = scrollHeight - scrollTop - clientHeight;
      const nearBottom = remainingDistance <= NEAR_BOTTOM_PX;
      const forcingBottom = performance.now() < forceScrollUntil.current;

      if (nearBottom) {
        stickToBottom.current = true;
      } else if (!forcingBottom && scrollTop < lastScrollTop - 1) {
        stickToBottom.current = false;
      }

      setShowScrollToBottomIfChanged(
        !forcingBottom && remainingDistance > SHOW_SCROLL_TO_BOTTOM_PX,
      );

      lastScrollTop = scrollTop;
    };

    const onUserIntent = () => {
      cancelForcedScroll();
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onUserIntent, { passive: true });
    el.addEventListener("touchstart", onUserIntent, { passive: true });
    el.addEventListener("pointerdown", onUserIntent, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onUserIntent);
      el.removeEventListener("touchstart", onUserIntent);
      el.removeEventListener("pointerdown", onUserIntent);
    };
  }, [cancelForcedScroll, setShowScrollToBottomIfChanged]);

  // Auto-scroll when content/container size changes
  // (virtualizer measuring, images loading, panel resizing, etc.)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      if (stickToBottom.current) scrollToBottom();
    });

    if (el.firstElementChild) ro.observe(el.firstElementChild);
    ro.observe(el);

    return () => ro.disconnect();
  }, [scrollToBottom]);

  return { ref, scrollToBottom, forceStickToBottom, onContentChange, showScrollToBottom };
}
