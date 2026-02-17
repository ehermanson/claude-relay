import { useRef, useEffect } from "react";

export function useAutoScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const stickToBottom = useRef(true);
  const isAutoScrolling = useRef(false);
  const rafId = useRef<number | null>(null);

  const scrollToBottom = () => {
    const el = ref.current;
    if (!el) return;
    isAutoScrolling.current = true;
    el.scrollTop = el.scrollHeight;
  };

  // Track user scroll intent — ignore programmatic scrolls
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onScroll = () => {
      if (isAutoScrolling.current) {
        isAutoScrolling.current = false;
        return;
      }
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
