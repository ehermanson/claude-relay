import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "relay.dismissedProviderAdvisories.v1";

function readKeys(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? new Set(parsed.filter((value): value is string => typeof value === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function writeKeys(keys: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Quota or private-mode: silently no-op. Dismissals will re-fire next
    // session, which is the safer side of the trade-off.
  }
}

/**
 * Tracks which provider-update notification keys the user has dismissed.
 * Keys are stable per (provider, latestVersion) tuple — see
 * `providerAdvisoryNotificationKey()` in provider-update-notification.logic.ts.
 * Persisted across reloads via localStorage; never crosses sessions across
 * different browsers / machines.
 */
export function useDismissedProviderAdvisories() {
  const [dismissed, setDismissed] = useState<Set<string>>(() => readKeys());

  // Sync across tabs in the same browser. When another tab dismisses an
  // advisory, this tab learns about it via the `storage` event so the toast
  // doesn't re-fire on focus.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      setDismissed(readKeys());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const dismiss = useCallback((key: string) => {
    setDismissed((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      writeKeys(next);
      return next;
    });
  }, []);

  return { dismissed, dismiss };
}
