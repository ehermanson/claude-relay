import { useCallback } from "react";
import { create } from "zustand";

// ── Server sync ───────────────────────────────────────────────────────────────

function syncOrderToServer(order: string[]): void {
  fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectOrder: order }),
  }).catch(() => {});
}

// ── Store ────────────────────────────────────────────────────────────────────

const COLLAPSED_KEY = "relay:project-collapsed";

function loadCollapsed(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveCollapsed(dirs: string[]): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(dirs));
  } catch {}
}

interface ProjectOrderState {
  order: string[];
  hydrated: boolean;
  setOrder: (next: string[] | ((prev: string[]) => string[])) => void;
  hydrateFromServer: (order: string[]) => void;
  moveToTop: (dir: string) => void;
  moveUp: (dir: string) => void;
  moveDown: (dir: string) => void;
  moveToBottom: (dir: string) => void;
  collapsed: Set<string>;
  toggleCollapsed: (dir: string) => void;
  setCollapsed: (dir: string, collapsed: boolean) => void;
}

/** Wrapper that persists after every mutation. */
function persistSet(
  set: (fn: (s: ProjectOrderState) => Partial<ProjectOrderState>) => void,
  fn: (s: ProjectOrderState) => Partial<ProjectOrderState>,
) {
  set((state) => fn(state));
}

const useProjectOrderStore = create<ProjectOrderState>()((set, get) => ({
  order: [],
  hydrated: false,

  setOrder: (next) => {
    const order = typeof next === "function" ? next(get().order) : next;
    syncOrderToServer(order);
    set({ order });
  },

  /** Apply the server-backed canonical order without echoing it back. */
  hydrateFromServer: (order) => {
    set({ order, hydrated: true });
  },

  moveToTop: (dir) =>
    persistSet(set, ({ order }) => {
      const next = [dir, ...order.filter((d) => d !== dir)];
      syncOrderToServer(next);
      return { order: next };
    }),

  moveUp: (dir) =>
    persistSet(set, ({ order }) => {
      const idx = order.indexOf(dir);
      if (idx <= 0) return { order };
      const next = [...order];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      syncOrderToServer(next);
      return { order: next };
    }),

  moveDown: (dir) =>
    persistSet(set, ({ order }) => {
      const idx = order.indexOf(dir);
      if (idx === -1 || idx >= order.length - 1) return { order };
      const next = [...order];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      syncOrderToServer(next);
      return { order: next };
    }),

  moveToBottom: (dir) =>
    persistSet(set, ({ order }) => {
      const next = [...order.filter((d) => d !== dir), dir];
      syncOrderToServer(next);
      return { order: next };
    }),

  collapsed: new Set(loadCollapsed()),

  toggleCollapsed: (dir) =>
    set((state) => {
      const next = new Set(state.collapsed);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      saveCollapsed([...next]);
      return { collapsed: next };
    }),

  setCollapsed: (dir, value) =>
    set((state) => {
      const next = new Set(state.collapsed);
      if (value) next.add(dir);
      else next.delete(dir);
      saveCollapsed([...next]);
      return { collapsed: next };
    }),
}));

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Persists a shared project ordering via the server-backed global settings row.
 *
 * Every component that calls this hook shares the same store, so Sidebar,
 * MiniSidebar, and Dashboard always agree on project order.
 *
 * Projects present in the stored order are sorted to match it;
 * any new (unseen) projects are appended at the end in alphabetical order.
 */
export function useProjectOrder() {
  const {
    order,
    hydrated,
    setOrder,
    hydrateFromServer,
    moveToTop,
    moveUp,
    moveDown,
    moveToBottom,
    collapsed,
    toggleCollapsed,
    setCollapsed,
  } = useProjectOrderStore();

  /**
   * Given a list of directory paths currently visible, returns them sorted
   * according to the stored order.  Unknown directories are appended
   * alphabetically at the end, and the stored order is updated to include them.
   */
  const applyOrder = useCallback(
    (dirs: string[]): string[] => {
      const dirSet = new Set(dirs);
      const storedSet = new Set(order);

      // Directories that are in the stored order (in stored sequence)
      const known = order.filter((d) => dirSet.has(d));

      // New directories not yet in the stored order
      const unknown = dirs
        .filter((d) => !storedSet.has(d))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

      return [...known, ...unknown];
    },
    [order],
  );

  const syncVisibleDirs = useCallback(
    (dirs: string[]) => {
      if (!hydrated) return;
      const storedSet = new Set(order);
      const unknown = dirs
        .filter((d) => !storedSet.has(d))
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

      // Preserve directories that are temporarily absent so we don't wipe the
      // saved order during initial empty renders before websocket sync finishes.
      if (unknown.length > 0) {
        setOrder([...order, ...unknown]);
      }
    },
    [hydrated, order, setOrder],
  );

  /** Sort a `[dir, T][]` entries array according to the stored project order. */
  const sortEntries = useCallback(
    <T>(entries: [string, T][]): [string, T][] => {
      const dirs = entries.map(([d]) => d);
      const sorted = applyOrder(dirs);
      const map = new Map(entries);
      return sorted.map((d) => [d, map.get(d)!]);
    },
    [applyOrder],
  );

  return {
    order,
    hydrated,
    sortEntries,
    hydrateFromServer,
    moveToTop,
    moveUp,
    moveDown,
    moveToBottom,
    syncVisibleDirs,
    collapsed,
    toggleCollapsed,
    setCollapsed,
  };
}

export function resetProjectOrderStoreForTests(): void {
  useProjectOrderStore.setState({
    order: [],
    hydrated: false,
    collapsed: new Set(),
  });
}
