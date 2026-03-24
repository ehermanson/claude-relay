/**
 * Manages sidecar panel visibility state — tracks which panels are active,
 * auto-activates when content first appears, and respects manual toggles.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type SidecarTab = "tasks" | "files" | "plan" | "context";

interface UseSidecarPanelsOptions {
  instanceId?: string;
  isMobile: boolean;
  hasTasksContent: boolean;
  hasFilesContent: boolean;
  hasPlanContent: boolean;
  hasStats: boolean;
}

export function useSidecarPanels({
  instanceId,
  isMobile,
  hasTasksContent,
  hasFilesContent,
  hasPlanContent,
  hasStats,
}: UseSidecarPanelsOptions) {
  const [activePanels, setActivePanels] = useState<Set<SidecarTab>>(new Set());
  const [mobileOpen, setMobileOpen] = useState(false);
  const manuallyToggledOff = useRef(new Set<SidecarTab>());
  const prevHasTasksRef = useRef(false);
  const prevHasFilesRef = useRef(false);
  const prevHasPlanRef = useRef(false);

  const togglePanel = useCallback((panel: SidecarTab) => {
    setActivePanels((prev) => {
      const next = new Set(prev);
      if (next.has(panel)) {
        next.delete(panel);
        manuallyToggledOff.current.add(panel);
      } else {
        next.add(panel);
        manuallyToggledOff.current.delete(panel);
      }
      return next;
    });
  }, []);

  // Reset when switching instances
  useEffect(() => {
    setMobileOpen(false);
    setActivePanels(new Set());
    manuallyToggledOff.current.clear();
    prevHasTasksRef.current = false;
    prevHasFilesRef.current = false;
    prevHasPlanRef.current = false;
  }, [instanceId]);

  // Auto-activate operational panels when content first appears
  useEffect(() => {
    const toActivate: SidecarTab[] = [];
    if (hasTasksContent && !prevHasTasksRef.current && !manuallyToggledOff.current.has("tasks"))
      toActivate.push("tasks");
    if (hasFilesContent && !prevHasFilesRef.current && !manuallyToggledOff.current.has("files"))
      toActivate.push("files");
    if (hasPlanContent && !prevHasPlanRef.current && !manuallyToggledOff.current.has("plan"))
      toActivate.push("plan");
    prevHasTasksRef.current = hasTasksContent;
    prevHasFilesRef.current = hasFilesContent;
    prevHasPlanRef.current = hasPlanContent;
    if (toActivate.length > 0) {
      setActivePanels((prev) => {
        const next = new Set(prev);
        for (const tab of toActivate) next.add(tab);
        return next;
      });
    }
  }, [hasTasksContent, hasFilesContent, hasPlanContent]);

  // Total content for mobile sidecar button badge
  const sidecarContentCount =
    (hasTasksContent ? 1 : 0) +
    (hasFilesContent ? 1 : 0) +
    (hasPlanContent ? 1 : 0) +
    (hasStats ? 1 : 0);

  // All panels with content — used for mobile overlay (shows everything)
  const allContentPanels = useMemo(() => {
    const s = new Set<SidecarTab>();
    if (hasTasksContent) s.add("tasks");
    if (hasFilesContent) s.add("files");
    if (hasPlanContent) s.add("plan");
    if (hasStats) s.add("context");
    return s;
  }, [hasTasksContent, hasFilesContent, hasPlanContent, hasStats]);

  // Desktop sidecar visible when any active panel has content
  const showDesktopSidecar =
    !isMobile &&
    ((activePanels.has("tasks") && hasTasksContent) ||
      (activePanels.has("files") && hasFilesContent) ||
      (activePanels.has("plan") && hasPlanContent) ||
      (activePanels.has("context") && hasStats));

  return {
    activePanels,
    mobileOpen,
    setMobileOpen,
    togglePanel,
    sidecarContentCount,
    allContentPanels,
    showDesktopSidecar,
  };
}
