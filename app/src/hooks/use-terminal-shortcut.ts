import { useEffect } from "react";
import { useTerminalStore } from "@/stores/terminal-store";

/**
 * Registers a Ctrl+` / Cmd+` keyboard shortcut to toggle the terminal panel
 * for the given scope key. Pass `null` to disable (e.g. in compact mode).
 */
export function useTerminalShortcut(scopeKey: string | null) {
  const togglePanel = useTerminalStore((s) => s.togglePanel);
  useEffect(() => {
    if (!scopeKey) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "`" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        togglePanel(scopeKey);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [scopeKey, togglePanel]);
}
