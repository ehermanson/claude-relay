import { create } from "zustand";

const COLLAPSED_KEY = "relay-sidebar-collapsed";
const WIDTH_KEY = "relay-sidebar-width";
const DEFAULT_WIDTH = 300;
const MIN_WIDTH = 200;
const MAX_WIDTH = 500;

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function loadWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    if (v >= MIN_WIDTH && v <= MAX_WIDTH) return v;
  } catch {}
  return DEFAULT_WIDTH;
}

interface LayoutState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  isResizing: boolean;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setIsResizing: (resizing: boolean) => void;
  /** Persist current width to localStorage (call on resize end). */
  persistWidth: () => void;
}

export const useLayoutStore = create<LayoutState>()((set, get) => ({
  sidebarCollapsed: loadCollapsed(),
  sidebarWidth: loadWidth(),
  isResizing: false,

  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {}
      return { sidebarCollapsed: next };
    }),

  setSidebarWidth: (width: number) =>
    set({ sidebarWidth: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)) }),

  setIsResizing: (resizing: boolean) => set({ isResizing: resizing }),

  persistWidth: () => {
    try {
      localStorage.setItem(WIDTH_KEY, String(get().sidebarWidth));
    } catch {}
  },
}));
