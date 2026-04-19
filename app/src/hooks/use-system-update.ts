import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { checkForUpdates, fetchUpdateStatus, installUpdate } from "@/lib/api";
import type { UpdateSnapshot, UpdateStage, UpdateStatus } from "@shared/types";

// Module-level interval so we only schedule one background check regardless of
// how many hook instances are mounted (mini-sidebar + sidebar + settings page).
let bgCheckInterval: ReturnType<typeof setInterval> | null = null;

const TOAST_ID = "system-update";
const QUERY_KEY = ["system-update"] as const;

const BUSY_STATUSES: readonly UpdateStatus[] = ["checking", "updating", "restart_pending"];

const INSTALL_BUSY_STATUSES: readonly UpdateStatus[] = ["updating", "restart_pending"];

/**
 * Human label for the in-progress stage of a running upgrade.
 * Returned only while the upgrade is busy; callers show it in buttons,
 * tooltips, and toasts so the UI reflects the real server-side step.
 */
export function describeUpdateStage(
  status: UpdateStatus | undefined,
  stage: UpdateStage | null | undefined,
): string | null {
  if (status === "checking") return "Checking for updates…";
  if (status === "restart_pending" || stage === "restarting") {
    return "Restarting Relay…";
  }
  if (status === "updating") {
    switch (stage) {
      case "pulling":
        return "Pulling latest code…";
      case "installing":
        return "Installing dependencies…";
      case "building":
        return "Building Relay…";
      default:
        return "Installing update…";
    }
  }
  return null;
}

/** How stale the last check can be before we auto-re-check (5 min = server TTL). */
const STALE_THRESHOLD_MS = 5 * 60 * 1000;
/** How often we proactively recheck in the background. */
const BG_CHECK_INTERVAL_MS = 30 * 60 * 1000;

export interface UseSystemUpdateResult {
  snapshot: UpdateSnapshot | undefined;
  isLoading: boolean;
  /** True whenever an install/check is active server-side or client-side. */
  isBusy: boolean;
  /** True specifically during install (excludes plain update checks). */
  isInstalling: boolean;
  /** Human label for the active stage, or null when idle. */
  stageLabel: string | null;
  /** True when server reports an update is installable and we're idle. */
  canInstall: boolean;
  install: () => void;
  check: (force?: boolean) => void;
  installPending: boolean;
  checkPending: boolean;
}

function formatShortCommit(commit: string | null | undefined): string | null {
  return commit ? commit.slice(0, 7) : null;
}

/**
 * Shared hook for the Relay self-update flow.
 *
 * Consolidates the polling query, install/check mutations, and the persistent
 * "system-update" toast so every update entrypoint (mini-sidebar, expanded
 * sidebar, settings page) stays in sync and shows the same staged progress.
 *
 * Post-install: once the server has restarted on the new commit, we swap the
 * persistent toast for a success toast with a "Reload" action — the old JS in
 * the browser is still talking to a freshly-rebuilt server, so the user needs
 * to refresh to pick up matching client code. We don't auto-reload because it
 * could trash in-flight drafts in other tabs that didn't trigger the update.
 */
export function useSystemUpdate(): UseSystemUpdateResult {
  const queryClient = useQueryClient();

  const { data: snapshot, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchUpdateStatus,
    staleTime: 30_000,
    // During a restart the server is briefly unreachable; keep retrying so we
    // notice it come back up instead of surfacing a transient error.
    retry: (failureCount) => failureCount < 10,
    retryDelay: 1_000,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && BUSY_STATUSES.includes(status) ? 1_000 : false;
    },
  });

  // Tracks whether an install is still awaiting its post-restart "ready" signal
  // so we can show the Reload action once the server is back on the new commit.
  const [pendingReload, setPendingReload] = useState(false);
  const preInstallCommitRef = useRef<string | null>(null);

  const installMutation = useMutation({
    mutationFn: installUpdate,
    onMutate: () => {
      preInstallCommitRef.current = snapshot?.currentCommit ?? null;
      setPendingReload(true);
      toast.loading("Starting Relay update…", {
        id: TOAST_ID,
        description: "Pulling, installing, and building the new version.",
        duration: Infinity,
      });
    },
    onSuccess: () => {
      toast.loading("Restarting Relay…", {
        id: TOAST_ID,
        description: "Reconnecting once the server comes back online.",
        duration: Infinity,
      });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error) => {
      setPendingReload(false);
      preInstallCommitRef.current = null;
      toast.error(error instanceof Error ? error.message : "Failed to install update", {
        id: TOAST_ID,
        description: undefined,
        duration: 8_000,
      });
    },
  });

  const checkMutation = useMutation({
    mutationFn: (force?: boolean) => checkForUpdates(Boolean(force)),
    onSuccess: (nextSnapshot) => {
      queryClient.setQueryData(QUERY_KEY, nextSnapshot);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to check for updates");
    },
  });

  // Auto-check: fire once when the snapshot first becomes enabled + stale,
  // then keep a 30-min background interval. Multiple hook instances share a
  // single module-level interval; the server deduplicates via checkPromise.
  useEffect(() => {
    if (!snapshot?.enabled) return;
    const stale = !snapshot.checkedAt || Date.now() - snapshot.checkedAt > STALE_THRESHOLD_MS;
    if (stale && !installMutation.isPending) {
      checkMutation.mutate(false);
    }
    if (!bgCheckInterval) {
      bgCheckInterval = setInterval(() => {
        checkMutation.mutate(false);
      }, BG_CHECK_INTERVAL_MS);
    }
    // Note: intentionally no cleanup — we want the interval to survive across
    // hook unmounts/remounts (e.g., navigating in and out of the settings page).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.enabled]);

  // Track the last stage key we rendered so we only update the persistent
  // "system-update" toast when the stage actually changes.
  const lastToastStageRef = useRef<string | null>(null);

  // Stage-tracking toast: fires while install is in-flight or the server-side
  // status is one of the install-busy states.
  useEffect(() => {
    const status = snapshot?.status;
    const installInProgress =
      installMutation.isPending || (status != null && INSTALL_BUSY_STATUSES.includes(status));

    if (!installInProgress) {
      lastToastStageRef.current = null;
      return;
    }

    const label = describeUpdateStage(status, snapshot?.stage);
    if (!label) return;
    const stageKey = `${status}:${snapshot?.stage ?? ""}`;
    if (lastToastStageRef.current === stageKey) return;
    lastToastStageRef.current = stageKey;
    toast.loading(label, {
      id: TOAST_ID,
      duration: Infinity,
    });
  }, [installMutation.isPending, snapshot?.status, snapshot?.stage]);

  // Post-restart toast: once we've cleared the busy states AND we see a commit
  // that differs from the one we captured before install, show the final
  // success toast with a Reload action. The user's browser is still running
  // the old JS bundle, so refreshing is the last step.
  useEffect(() => {
    if (!pendingReload) return;
    if (installMutation.isPending) return;
    const status = snapshot?.status;
    if (status == null) return;

    if (status === "error") {
      setPendingReload(false);
      preInstallCommitRef.current = null;
      toast.error(snapshot?.error ?? "Relay update failed", {
        id: TOAST_ID,
        duration: 8_000,
      });
      return;
    }

    if (INSTALL_BUSY_STATUSES.includes(status)) return;

    const before = preInstallCommitRef.current;
    const after = snapshot?.currentCommit ?? null;
    const commitChanged = !!after && !!before && after !== before;

    if (!commitChanged) return;

    setPendingReload(false);
    preInstallCommitRef.current = null;

    const shortCommit = formatShortCommit(after);
    toast.success(shortCommit ? `Relay updated to ${shortCommit}` : "Relay updated", {
      id: TOAST_ID,
      description: "Reload the page to finish switching to the new version.",
      duration: Infinity,
      action: {
        label: "Reload",
        onClick: () => {
          if (typeof window !== "undefined") window.location.reload();
        },
      },
    });
  }, [
    pendingReload,
    installMutation.isPending,
    snapshot?.status,
    snapshot?.currentCommit,
    snapshot?.error,
  ]);

  const status = snapshot?.status;
  const isBusy =
    installMutation.isPending ||
    checkMutation.isPending ||
    (status != null && BUSY_STATUSES.includes(status));
  const isInstalling =
    installMutation.isPending || status === "updating" || status === "restart_pending";
  const stageLabel = isInstalling
    ? (describeUpdateStage(status, snapshot?.stage) ?? "Installing update…")
    : status === "checking"
      ? "Checking for updates…"
      : null;
  const canInstall = Boolean(snapshot?.enabled && snapshot?.updateAvailable && !isBusy);

  const install = useCallback(() => {
    if (installMutation.isPending) return;
    installMutation.mutate();
  }, [installMutation]);

  const check = useCallback(
    (force = false) => {
      checkMutation.mutate(force);
    },
    [checkMutation],
  );

  return {
    snapshot,
    isLoading,
    isBusy,
    isInstalling,
    stageLabel,
    canInstall,
    install,
    check,
    installPending: installMutation.isPending,
    checkPending: checkMutation.isPending,
  };
}
