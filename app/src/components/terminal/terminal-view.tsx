/**
 * TerminalView — xterm.js wrapper that renders a single terminal session.
 */

import { useEffect, useRef, useCallback, useState, memo } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Paperclip } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import { useTerminal } from "@/hooks/use-terminal";
import { useTerminalStore } from "@/stores/terminal-store";
import { useThemeStore } from "@/stores/theme-store";
import type { TerminalScope } from "@shared/types";

// ── Theme palettes ───────────────────────────────────────────────────

const DARK_THEME: ITheme = {
  background: "#161618",
  foreground: "#d4d4d4",
  cursor: "#f5f5f5",
  cursorAccent: "#161618",
  selectionBackground: "#ffffff30",
  selectionForeground: undefined,
  selectionInactiveBackground: "#ffffff18",
  scrollbarSliderBackground: "#ffffff20",
  scrollbarSliderHoverBackground: "#ffffff40",
  scrollbarSliderActiveBackground: "#ffffff50",
  black: "#161618",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#d4d4d4",
  brightBlack: "#525252",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#f5f5f5",
};

const LIGHT_THEME: ITheme = {
  background: "#ffffff",
  foreground: "#161618",
  cursor: "#161618",
  cursorAccent: "#ffffff",
  selectionBackground: "#00000020",
  selectionForeground: undefined,
  selectionInactiveBackground: "#00000010",
  scrollbarSliderBackground: "#00000018",
  scrollbarSliderHoverBackground: "#00000030",
  scrollbarSliderActiveBackground: "#00000040",
  black: "#161618",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#e5e5e5",
  brightBlack: "#737373",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#eab308",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#fafafa",
};

function getTheme(mode: "dark" | "light"): ITheme {
  return mode === "light" ? LIGHT_THEME : DARK_THEME;
}

// ── Component ────────────────────────────────────────────────────────

interface TerminalViewProps {
  terminalId: string;
  scope: TerminalScope;
  /** Index of this terminal in its scope (for default naming). */
  index?: number;
  /** The instance ID that terminal context attachments should be associated with. */
  activeInstanceId?: string | null;
}

export const TerminalView = memo(function TerminalView({
  terminalId,
  scope,
  index = 0,
  activeInstanceId,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { addTerminalContext, getTerminalName } = useTerminalStore();
  const theme = useThemeStore((s) => s.theme);

  // Selection popup state
  const [selectionPopup, setSelectionPopup] = useState<{ x: number; y: number } | null>(null);
  const lastMouseUpRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Buffer data that arrives before xterm is ready
  const pendingDataRef = useRef<string[]>([]);
  const xtermReadyRef = useRef(false);

  const handleData = useCallback((data: string) => {
    if (xtermReadyRef.current && xtermRef.current) {
      xtermRef.current.write(data);
    } else {
      pendingDataRef.current.push(data);
    }
  }, []);

  const handleScrollback = useCallback((data: string) => {
    if (xtermReadyRef.current && xtermRef.current) {
      xtermRef.current.write(data);
    } else {
      pendingDataRef.current.unshift(data);
    }
  }, []);

  const { write, resize } = useTerminal({
    terminalId,
    scope,
    onData: handleData,
    onScrollback: handleScrollback,
  });

  // Create and mount xterm
  useEffect(() => {
    if (!containerRef.current) return;

    xtermReadyRef.current = false;
    pendingDataRef.current = [];
    setSelectionPopup(null);

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 11,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
      lineHeight: 1.25,
      scrollback: 5000,
      allowProposedApi: true,
      theme: getTheme(theme),
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    xtermRef.current = terminal;
    fitAddonRef.current = fitAddon;

    terminal.open(containerRef.current);

    requestAnimationFrame(() => {
      try {
        fitAddon.fit();
        resize(terminal.cols, terminal.rows);
      } catch {
        // fit() can throw if not visible
      }

      xtermReadyRef.current = true;
      for (const chunk of pendingDataRef.current) {
        terminal.write(chunk);
      }
      pendingDataRef.current = [];
    });

    const dataDisposable = terminal.onData((data) => {
      write(data);
    });

    // Track selection changes — show/hide attach popup
    const selectionDisposable = terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (selection.trim()) {
        // Position near the last mouseup, clamped within the container
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const x = Math.min(Math.max(lastMouseUpRef.current.x - rect.left, 0), rect.width - 140);
          const y = Math.min(
            Math.max(lastMouseUpRef.current.y - rect.top - 32, 0),
            rect.height - 30,
          );
          setSelectionPopup({ x, y });
        }
      } else {
        setSelectionPopup(null);
      }
    });

    return () => {
      xtermReadyRef.current = false;
      dataDisposable.dispose();
      selectionDisposable.dispose();
      terminal.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId]);

  // Track mouseup position for popup placement
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handler = (e: MouseEvent) => {
      lastMouseUpRef.current = { x: e.clientX, y: e.clientY };
    };
    container.addEventListener("mouseup", handler);
    return () => container.removeEventListener("mouseup", handler);
  }, []);

  // Dismiss popup on mousedown (new interaction starting)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !selectionPopup) return;

    const handler = () => setSelectionPopup(null);
    container.addEventListener("mousedown", handler);
    return () => container.removeEventListener("mousedown", handler);
  }, [selectionPopup]);

  // React to theme changes
  useEffect(() => {
    if (xtermRef.current?.options.theme) {
      xtermRef.current.options.theme = getTheme(theme);
    }
  }, [theme]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current && xtermReadyRef.current) {
        try {
          fitAddonRef.current.fit();
          const term = xtermRef.current;
          if (term) {
            resize(term.cols, term.rows);
          }
        } catch {
          // fit() can throw if terminal is not visible
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [resize]);

  const handleAttach = useCallback(() => {
    if (!activeInstanceId) return;
    const selection = xtermRef.current?.getSelection();
    if (selection?.trim()) {
      const name = getTerminalName(terminalId, index);
      addTerminalContext(activeInstanceId, name, selection);
      xtermRef.current?.clearSelection();
      setSelectionPopup(null);
    }
  }, [addTerminalContext, getTerminalName, terminalId, index, activeInstanceId]);

  return (
    <div className="relative flex h-full flex-col">
      <div ref={containerRef} className="min-h-0 flex-1 px-1 py-1 bg-bg" />
      {selectionPopup && (
        <button
          type="button"
          onClick={handleAttach}
          className="absolute z-10 flex items-center gap-1.5 rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-[0.6875rem] font-medium text-text shadow-raised transition-colors hover:bg-surface-hover"
          style={{ left: selectionPopup.x, top: selectionPopup.y }}
        >
          <Paperclip size={12} />
          Attach to Chat
        </button>
      )}
    </div>
  );
});
