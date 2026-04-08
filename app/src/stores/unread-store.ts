import { create } from "zustand";

const STORAGE_KEY = "relay-unread";

/**
 * Tracks per-instance "last read" timestamps so the sidebar can show
 * status dots only for instances with unseen activity.
 *
 * An instance is "unread" when its `lastActivityAt` exceeds the stored
 * `lastReadAt`. Instances with no entry are treated as read (no dot)
 * to avoid noise on first load / cold start.
 */

interface UnreadState {
  /** instanceId → timestamp (ms) when the user last viewed the instance */
  lastReadAt: Record<string, number>;
  /** Mark an instance as read right now. */
  markRead: (instanceId: string) => void;
  /** Remove tracking for a deleted instance. */
  forget: (instanceId: string) => void;
}

function load(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

function persist(data: Record<string, number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

export const useUnreadStore = create<UnreadState>()((set) => ({
  lastReadAt: load(),

  markRead: (instanceId: string) =>
    set((s) => {
      const next = { ...s.lastReadAt, [instanceId]: Date.now() };
      persist(next);
      return { lastReadAt: next };
    }),

  forget: (instanceId: string) =>
    set((s) => {
      const next = { ...s.lastReadAt };
      delete next[instanceId];
      persist(next);
      return { lastReadAt: next };
    }),
}));

/** Selector-friendly unread check — reads from store state directly so
 *  zustand can track the dependency and trigger re-renders. */
export function selectHasUnread(s: UnreadState, instanceId: string, lastActivityAt: number) {
  const readAt = s.lastReadAt[instanceId];
  if (readAt === undefined) return false;
  return lastActivityAt > readAt;
}
