import { useRef, useEffect, useCallback } from "react";

const NEAR_BOTTOM_PX = 64;

export function useAutoScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const stickToBottom = useRef(true);

  const scrollToBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Force scroll to bottom — session switch / initial load
  const forceStickToBottom = useCallback(() => {
    stickToBottom.current = true;
    scrollToBottom();
    requestAnimationFrame(scrollToBottom);
  }, [scrollToBottom]);

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
      const nearBottom = scrollHeight - scrollTop - clientHeight <= NEAR_BOTTOM_PX;

      if (nearBottom) {
        stickToBottom.current = true;
      } else if (scrollTop < lastScrollTop - 1) {
        stickToBottom.current = false;
      }

      lastScrollTop = scrollTop;
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

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

  return { ref, scrollToBottom, forceStickToBottom, onContentChange };
}
