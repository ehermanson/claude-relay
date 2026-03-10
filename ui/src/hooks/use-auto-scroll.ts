import { useRef, useEffect } from "react";

// How long after mount to ignore user-scroll detection.
// During this window the virtualizer is still measuring rows and
// changing scrollHeight, which produces scroll events that would
// falsely disable stick-to-bottom.
const SETTLE_MS = 500;

export function useAutoScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const stickToBottom = useRef(true);
  const isAutoScrolling = useRef(false);
  const rafId = useRef<number | null>(null);
  const settledAt = useRef(0); // timestamp when settling window ends

  const scrollToBottom = () => {
    const el = ref.current;
    if (!el) return;
    isAutoScrolling.current = true;
    el.scrollTop = el.scrollHeight;
  };

  // Start the settling window on mount
  useEffect(() => {
    settledAt.current = Date.now() + SETTLE_MS;
  }, []);

  // Track user scroll intent — ignore programmatic scrolls
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onScroll = () => {
      if (isAutoScrolling.current) {
        isAutoScrolling.current = false;
        return;
      }
      // Ignore scroll events during settling — virtualizer layout
      // changes scrollHeight which fires spurious scroll events
      if (Date.now() < settledAt.current) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      stickToBottom.current = scrollHeight - scrollTop - clientHeight < 60;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll on any content or container change
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const scheduleScroll = () => {
      if (rafId.current !== null) return;
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        if (stickToBottom.current && el) {
          isAutoScrolling.current = true;
          el.scrollTop = el.scrollHeight;
        }
      });
    };

    // ResizeObserver on content — catches layout shifts, images, expand/collapse
    const resizeObserver = new ResizeObserver(scheduleScroll);
    const content = el.firstElementChild;
    if (content) resizeObserver.observe(content);
    // Also observe the scroll container — catches sidecar/panel resizes
    resizeObserver.observe(el);

    // MutationObserver — catches all DOM changes (new nodes, text updates)
    const mutationObserver = new MutationObserver(scheduleScroll);
    mutationObserver.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  const onContentChange = () => {
    if (stickToBottom.current) {
      scrollToBottom();
    }
  };

  return { ref, scrollToBottom, onContentChange };
}
