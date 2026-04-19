import { useEffect, useRef, useState } from "react";

interface ConnectionBanner {
  kind: "reconnecting" | "resyncing" | "running" | "interrupted";
  onDismiss?: () => void;
  onContinue?: () => void;
  onRetry?: () => void;
}

const AUTO_DISMISS_MS = 15_000;

// Grace period before showing the reconnecting banner on initial load.
// Avoids a flash during normal cold-start WS handshake.
const INITIAL_CONNECT_GRACE_MS = 3_000;

/**
 * Derives the connection-status banner for an instance view.
 *
 * Tracks WS disconnect/reconnect transitions and returns a banner descriptor
 * (or null) that tells the caller what, if anything, to render.
 */
export function useConnectionBanner({
  isConnected,
  connectionId,
  isActive,
  isSyncing,
  isExternal,
  isStopped,
  isLoadingSession,
  onContinue,
  onRetry,
}: {
  isConnected: boolean;
  connectionId: number;
  isActive: boolean;
  isSyncing: boolean;
  isExternal: boolean;
  isStopped: boolean;
  isLoadingSession: boolean;
  onContinue: () => void;
  onRetry: () => void;
}): ConnectionBanner | null {
  const [reconnectAt, setReconnectAt] = useState<number | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  // Whether the initial grace period has elapsed without connecting.
  const [initialGraceElapsed, setInitialGraceElapsed] = useState(false);

  const prevConnectedRef = useRef(isConnected);
  const prevConnectionIdRef = useRef(connectionId);
  const wasActiveAtDisconnectRef = useRef(false);

  // Show the reconnecting banner after the grace period if we still haven't connected.
  // This covers the case where the WS never establishes (e.g. on a slow Tailscale link),
  // so connectionId stays 0 and the user would otherwise see a silently disabled input.
  useEffect(() => {
    if (isConnected) return;
    const timer = setTimeout(() => setInitialGraceElapsed(true), INITIAL_CONNECT_GRACE_MS);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect disconnect-while-active and reconnection in one pass.
  useEffect(() => {
    // Connection dropped while the agent was working?
    if (prevConnectedRef.current && !isConnected && isActive) {
      wasActiveAtDisconnectRef.current = true;
    }

    // New WS connection established (skip the very first)?
    const prevId = prevConnectionIdRef.current;
    if (connectionId > prevId && prevId > 0) {
      setReconnectAt(Date.now());
      setDismissedKey(null);
    }

    prevConnectedRef.current = isConnected;
    prevConnectionIdRef.current = connectionId;
  }, [isConnected, connectionId, isActive]);

  // Auto-dismiss after timeout.
  useEffect(() => {
    if (!reconnectAt) return;
    const timer = setTimeout(() => {
      setReconnectAt(null);
      setDismissedKey(null);
      wasActiveAtDisconnectRef.current = false;
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [reconnectAt]);

  // --- Derive the banner ---

  let banner: (ConnectionBanner & { key: string }) | null = null;

  // Show reconnecting when disconnected — either after a prior successful connection
  // (connectionId > 0) or after the initial grace period has elapsed.
  if (!isConnected && (connectionId > 0 || initialGraceElapsed)) {
    banner = { key: "reconnecting", kind: "reconnecting" };
  } else if (reconnectAt && isSyncing) {
    banner = { key: `resyncing-${reconnectAt}`, kind: "resyncing" };
  } else if (reconnectAt && !isExternal && wasActiveAtDisconnectRef.current && !isLoadingSession) {
    banner = isActive
      ? { key: `running-${reconnectAt}`, kind: "running" }
      : { key: `interrupted-${reconnectAt}`, kind: "interrupted" };
  }

  if (!banner || dismissedKey === banner.key) return null;

  // Build the public return value (no internal key exposed).
  const dismissible = banner.kind === "running" || banner.kind === "interrupted";
  const result: ConnectionBanner = { kind: banner.kind };
  if (dismissible) result.onDismiss = () => setDismissedKey(banner!.key);
  if (banner.kind === "interrupted" && !isStopped) result.onContinue = onContinue;
  if (banner.kind === "reconnecting") result.onRetry = onRetry;
  return result;
}
