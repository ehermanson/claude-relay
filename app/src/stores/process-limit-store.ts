import { create } from "zustand";
import { MaxProcessesError } from "@/lib/api";

/**
 * Drives the "free up capacity" dialog shown when creating a chat fails because
 * the concurrent managed-process cap was reached.
 *
 * `pendingRetry` is the original create action that hit the cap. Once the user
 * stops enough sessions to free a slot, the dialog re-runs it automatically.
 */
interface ProcessLimitState {
  open: boolean;
  /** The configured cap (e.g. 15). 0 until known. */
  limit: number;
  /** Re-run the create that hit the cap, or null if none was supplied. */
  pendingRetry: (() => void | Promise<void>) | null;
  openDialog: (opts: { limit: number; retry?: () => void | Promise<void> }) => void;
  close: () => void;
}

export const useProcessLimitStore = create<ProcessLimitState>()((set) => ({
  open: false,
  limit: 0,
  pendingRetry: null,
  openDialog: ({ limit, retry }) => set({ open: true, limit, pendingRetry: retry ?? null }),
  close: () => set({ open: false, pendingRetry: null }),
}));

/**
 * If `error` is a max-processes rejection, open the capacity dialog (optionally
 * remembering `retry` to auto-run once a slot frees) and return true. Otherwise
 * return false so the caller can fall back to its own error handling.
 */
export function reportCreateInstanceError(
  error: unknown,
  retry?: () => void | Promise<void>,
): boolean {
  if (error instanceof MaxProcessesError) {
    useProcessLimitStore.getState().openDialog({ limit: error.limit, retry });
    return true;
  }
  return false;
}
