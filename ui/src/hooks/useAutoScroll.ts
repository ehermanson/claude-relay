import { useRef, useCallback, useEffect } from "react";

export function useAutoScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const stickToBottom = useRef(true);

  const scrollToBottom = useCallback(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      stickToBottom.current = scrollHeight - scrollTop - clientHeight < 60;
    };

    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const onContentChange = useCallback(() => {
    if (stickToBottom.current) {
      scrollToBottom();
    }
  }, [scrollToBottom]);

  return { ref, scrollToBottom, onContentChange };
}
