import { useEffect } from "react";

/**
 * Registers a Ctrl+` / Cmd+` keyboard shortcut to toggle the terminal panel.
 * Pass `null` as the handler to disable (e.g. in compact mode).
 */
export function useTerminalShortcut(handler: (() => void) | null) {
  useEffect(() => {
    if (!handler) return;
    const listener = (e: KeyboardEvent) => {
      if (e.key === "`" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [handler]);
}
