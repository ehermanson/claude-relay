/**
 * Zustand store for sidecar panel visibility.
 *
 * Each instance/space gets its own slice of state keyed by ID.
 * Auto-activates panels when content first appears, respects manual dismissals.
 */

import { useCallback, useEffect, useMemo } from "react";
import { create } from "zustand";

export type SidecarTab = "tasks" | "files" | "plan" | "context";

// ── Internal per-instance state ──────────────────────────────────────────────

interface InstanceSidecar {
  activePanels: Set<SidecarTab>;
  mobileOpen: boolean;
  manuallyToggledOff: Set<SidecarTab>;
  prevHasTasks: boolean;
  prevHasFiles: boolean;
  prevHasPlan: boolean;
}

function emptyInstance(): InstanceSidecar {
  return {
    activePanels: new Set(),
    mobileOpen: false,
    manuallyToggledOff: new Set(),
    prevHasTasks: false,
    prevHasFiles: false,
    prevHasPlan: false,
  };
}

// ── Store ────────────────────────────────────────────────────────────────────

interface SidecarState {
  instances: Record<string, InstanceSidecar>;
  togglePanel: (instanceId: string, panel: SidecarTab) => void;
  setMobileOpen: (instanceId: string, open: boolean) => void;
  resetInstance: (instanceId: string) => void;
  /** Called when content flags change — auto-activates panels on first appearance. */
  syncContent: (instanceId: string, hasTasks: boolean, hasFiles: boolean, hasPlan: boolean) => void;
}

function getOrCreate(state: SidecarState, id: string): InstanceSidecar {
  return state.instances[id] ?? emptyInstance();
}

export const useSidecarStore = create<SidecarState>()((set) => ({
  instances: {},

  togglePanel: (instanceId, panel) =>
    set((state) => {
      const inst = { ...getOrCreate(state, instanceId) };
      const next = new Set(inst.activePanels);
      const toggled = new Set(inst.manuallyToggledOff);
      if (next.has(panel)) {
        next.delete(panel);
        toggled.add(panel);
      } else {
        next.add(panel);
        toggled.delete(panel);
      }
      inst.activePanels = next;
      inst.manuallyToggledOff = toggled;
      return { instances: { ...state.instances, [instanceId]: inst } };
    }),

  setMobileOpen: (instanceId, open) =>
    set((state) => {
      const inst = { ...getOrCreate(state, instanceId), mobileOpen: open };
      return { instances: { ...state.instances, [instanceId]: inst } };
    }),

  resetInstance: (instanceId) =>
    set((state) => ({
      instances: { ...state.instances, [instanceId]: emptyInstance() },
    })),

  syncContent: (instanceId, hasTasks, hasFiles, hasPlan) =>
    set((state) => {
      const prev = getOrCreate(state, instanceId);
      const toActivate: SidecarTab[] = [];
      if (hasTasks && !prev.prevHasTasks && !prev.manuallyToggledOff.has("tasks"))
        toActivate.push("tasks");
      if (hasFiles && !prev.prevHasFiles && !prev.manuallyToggledOff.has("files"))
        toActivate.push("files");
      if (hasPlan && !prev.prevHasPlan && !prev.manuallyToggledOff.has("plan"))
        toActivate.push("plan");

      // Nothing changed — skip update
      if (
        toActivate.length === 0 &&
        prev.prevHasTasks === hasTasks &&
        prev.prevHasFiles === hasFiles &&
        prev.prevHasPlan === hasPlan
      )
        return state;

      const activePanels = new Set(prev.activePanels);
      for (const tab of toActivate) activePanels.add(tab);

      return {
        instances: {
          ...state.instances,
          [instanceId]: {
            ...prev,
            activePanels,
            prevHasTasks: hasTasks,
            prevHasFiles: hasFiles,
            prevHasPlan: hasPlan,
          },
        },
      };
    }),
}));

// ── Hook (drop-in replacement for the old useSidecarPanels) ──────────────────

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
  const instances = useSidecarStore((s) => s.instances);
  const syncContent = useSidecarStore((s) => s.syncContent);
  const storeTogglePanel = useSidecarStore((s) => s.togglePanel);
  const storeSetMobileOpen = useSidecarStore((s) => s.setMobileOpen);
  const id = instanceId ?? "__none__";

  // Sync content flags into store — auto-activates panels when content first appears.
  useEffect(() => {
    syncContent(id, hasTasksContent, hasFilesContent, hasPlanContent);
  }, [syncContent, id, hasTasksContent, hasFilesContent, hasPlanContent]);

  const inst = instances[id] ?? emptyInstance();

  const togglePanel = useCallback(
    (panel: SidecarTab) => storeTogglePanel(id, panel),
    [storeTogglePanel, id],
  );
  const setMobileOpen = useCallback(
    (open: boolean) => storeSetMobileOpen(id, open),
    [storeSetMobileOpen, id],
  );

  const sidecarContentCount =
    (hasTasksContent ? 1 : 0) +
    (hasFilesContent ? 1 : 0) +
    (hasPlanContent ? 1 : 0) +
    (hasStats ? 1 : 0);

  const allContentPanels = useMemo(() => {
    const s = new Set<SidecarTab>();
    if (hasTasksContent) s.add("tasks");
    if (hasFilesContent) s.add("files");
    if (hasPlanContent) s.add("plan");
    if (hasStats) s.add("context");
    return s;
  }, [hasTasksContent, hasFilesContent, hasPlanContent, hasStats]);

  const showDesktopSidecar =
    !isMobile &&
    ((inst.activePanels.has("tasks") && hasTasksContent) ||
      (inst.activePanels.has("files") && hasFilesContent) ||
      (inst.activePanels.has("plan") && hasPlanContent) ||
      (inst.activePanels.has("context") && hasStats));

  return {
    activePanels: inst.activePanels,
    mobileOpen: inst.mobileOpen,
    setMobileOpen,
    togglePanel,
    sidecarContentCount,
    allContentPanels,
    showDesktopSidecar,
  };
}
