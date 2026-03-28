/**
 * useVerticalResize — drag-to-resize hook for the terminal bottom panel.
 *
 * Similar to useResizablePanel but operates on height (vertical axis).
 */

import { useCallback, useState } from "react";
import { useTerminalStore } from "../stores/terminal-store";

export function useVerticalResize() {
  const { panelHeight, setPanelHeight, persistHeight } = useTerminalStore();
  const [isResizing, setIsResizing] = useState(false);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      const startY = e.clientY;
      const startHeight = panelHeight;

      const onMouseMove = (ev: MouseEvent) => {
        // Dragging up → increases height
        const delta = startY - ev.clientY;
        setPanelHeight(startHeight + delta);
      };

      const onMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        persistHeight();
      };

      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [panelHeight, setPanelHeight, persistHeight],
  );

  return { height: panelHeight, isResizing, onResizeStart };
}
