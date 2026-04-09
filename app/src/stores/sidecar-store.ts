/**
 * Zustand store for sidecar panel visibility.
 *
 * Preferences are GLOBAL: one set for chat views, one set for space views.
 * Toggling a panel in any chat updates the chat-wide preference; toggling in
 * any space updates the space-wide preference. Panels only render when the
 * current chat/space actually has content for them.
 *
 * Sidebar width is also global and shared between chat and space views.
 */

import { useCallback, useMemo } from "react";
import { create } from "zustand";

export type SidecarTab = "tasks" | "files" | "plan" | "context" | "brief";
export type SidecarScope = "chat" | "space";

// ── Persistence ─────────────────────────────────────────────────────────────

const STORAGE_KEY = "relay-sidecar-prefs";

interface PersistedState {
  chatPanels: SidecarTab[];
  spacePanels: SidecarTab[];
  sidebarWidth: number | null;
}

// Seeds first-run experience: tasks+files visible in chat, brief+files in space
const DEFAULT_CHAT_PANELS: SidecarTab[] = ["tasks", "files"];
const DEFAULT_SPACE_PANELS: SidecarTab[] = ["brief", "files"];

function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      return {
        chatPanels: Array.isArray(parsed.chatPanels) ? parsed.chatPanels : DEFAULT_CHAT_PANELS,
        spacePanels: Array.isArray(parsed.spacePanels) ? parsed.spacePanels : DEFAULT_SPACE_PANELS,
        sidebarWidth: typeof parsed.sidebarWidth === "number" ? parsed.sidebarWidth : null,
      };
    }
  } catch {
    // fall through
  }
  return {
    chatPanels: DEFAULT_CHAT_PANELS,
    spacePanels: DEFAULT_SPACE_PANELS,
    sidebarWidth: null,
  };
}

function persist(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

// ── Store ────────────────────────────────────────────────────────────────────

interface SidecarState {
  chatPanels: Set<SidecarTab>;
  spacePanels: Set<SidecarTab>;
  sidebarWidth: number | null;
  mobileOpen: boolean;

  togglePanel: (scope: SidecarScope, panel: SidecarTab) => void;
  setMobileOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
}

function panelsKey(scope: SidecarScope): "chatPanels" | "spacePanels" {
  return scope === "chat" ? "chatPanels" : "spacePanels";
}

export const useSidecarStore = create<SidecarState>()((set, get) => {
  const loaded = loadPersisted();

  const snapshot = (): PersistedState => {
    const s = get();
    return {
      chatPanels: Array.from(s.chatPanels),
      spacePanels: Array.from(s.spacePanels),
      sidebarWidth: s.sidebarWidth,
    };
  };

  return {
    chatPanels: new Set(loaded.chatPanels),
    spacePanels: new Set(loaded.spacePanels),
    sidebarWidth: loaded.sidebarWidth,
    mobileOpen: false,

    togglePanel: (scope, panel) =>
      set((state) => {
        const key = panelsKey(scope);
        const next = new Set(state[key]);
        if (next.has(panel)) next.delete(panel);
        else next.add(panel);
        const updated = { ...state, [key]: next };
        persist({
          chatPanels: Array.from(updated.chatPanels),
          spacePanels: Array.from(updated.spacePanels),
          sidebarWidth: updated.sidebarWidth,
        });
        return updated;
      }),

    setMobileOpen: (open) => set({ mobileOpen: open }),

    setSidebarWidth: (width) => {
      set({ sidebarWidth: width });
      persist(snapshot());
    },
  };
});

// ── Hook ────────────────────────────────────────────────────────────────────

interface UseSidecarPanelsOptions {
  scope: SidecarScope;
  isMobile: boolean;
  hasTasksContent: boolean;
  hasFilesContent: boolean;
  hasPlanContent: boolean;
  hasStats: boolean;
  hasBriefContent?: boolean;
}

export function useSidecarPanels({
  scope,
  isMobile,
  hasTasksContent,
  hasFilesContent,
  hasPlanContent,
  hasStats,
  hasBriefContent = false,
}: UseSidecarPanelsOptions) {
  const activePanels = useSidecarStore((s) => (scope === "chat" ? s.chatPanels : s.spacePanels));
  const mobileOpen = useSidecarStore((s) => s.mobileOpen);
  const storeTogglePanel = useSidecarStore((s) => s.togglePanel);
  const storeSetMobileOpen = useSidecarStore((s) => s.setMobileOpen);

  const togglePanel = useCallback(
    (panel: SidecarTab) => storeTogglePanel(scope, panel),
    [storeTogglePanel, scope],
  );
  const setMobileOpen = useCallback(
    (open: boolean) => storeSetMobileOpen(open),
    [storeSetMobileOpen],
  );

  const sidecarContentCount =
    (hasTasksContent ? 1 : 0) +
    (hasFilesContent ? 1 : 0) +
    (hasPlanContent ? 1 : 0) +
    (hasStats ? 1 : 0) +
    (hasBriefContent ? 1 : 0);

  const allContentPanels = useMemo(() => {
    const s = new Set<SidecarTab>();
    if (hasTasksContent) s.add("tasks");
    if (hasFilesContent) s.add("files");
    if (hasPlanContent) s.add("plan");
    if (hasStats) s.add("context");
    if (hasBriefContent) s.add("brief");
    return s;
  }, [hasTasksContent, hasFilesContent, hasPlanContent, hasStats, hasBriefContent]);

  const showDesktopSidecar =
    !isMobile &&
    ((activePanels.has("tasks") && hasTasksContent) ||
      (activePanels.has("files") && hasFilesContent) ||
      (activePanels.has("plan") && hasPlanContent) ||
      (activePanels.has("context") && hasStats) ||
      (activePanels.has("brief") && hasBriefContent));

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
