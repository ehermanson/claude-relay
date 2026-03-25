import { useCallback, useRef, useState } from "react";

export interface ResizablePanelOptions {
  /** Which side the panel is on — determines drag direction. */
  side: "left" | "right";
  /** Minimum width in pixels. */
  minWidth?: number;
  /** Maximum width in pixels, or a fraction (0–1) of the container. */
  maxWidth?: number | ((containerWidth: number) => number);
  /** Default width in pixels (or null to use CSS/percentage). */
  defaultWidth?: number | null;
  /** Called with the final width when the user finishes dragging. */
  onResizeEnd?: (width: number) => void;
}

export function useResizablePanel({
  side,
  minWidth = 200,
  maxWidth = 500,
  defaultWidth = null,
  onResizeEnd,
}: ResizablePanelOptions) {
  const panelRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);

  const clamp = useCallback(
    (value: number) => {
      const containerWidth = containerRef.current?.offsetWidth ?? Infinity;
      const max = typeof maxWidth === "function" ? maxWidth(containerWidth) : maxWidth;
      return Math.max(minWidth, Math.min(max, value));
    },
    [minWidth, maxWidth],
  );

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startX = e.clientX;
      const startWidth = panelRef.current?.offsetWidth ?? 0;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = side === "right" ? startX - ev.clientX : ev.clientX - startX;
        setWidth(clamp(startWidth + delta));
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        if (onResizeEnd && panelRef.current) {
          onResizeEnd(panelRef.current.offsetWidth);
        }
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [side, clamp, onResizeEnd],
  );

  return { panelRef, containerRef, width, isResizing, onResizeStart, setWidth };
}
