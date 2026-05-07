import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import type { InstanceStatus } from "@shared/types";
import { getProviderDisplayName } from "@shared/provider-catalog";
import { useWSMethods, useWSState } from "../context/websocket-context";
import { getInstanceChatRoute } from "../lib/project-route";

interface PrevState {
  status: InstanceStatus;
}

/**
 * Watches all instances for processing→idle/error transitions and toasts when
 * a chat the user is not actively viewing finishes its turn. "Not viewing"
 * means a different chat ID, a non-chat page, or a hidden browser tab.
 *
 * Only fires after the user has explicitly sent a message — this filters out
 * incidental processing→idle transitions (e.g. resume/revive, post-cancel
 * settling) that aren't really "your agent is ready" moments.
 */
export function useTurnEndToasts(currentId?: string) {
  const { instances } = useWSState();
  const { consumeUserAwaitingReply, clearUserAwaitingReply } = useWSMethods();
  const navigate = useNavigate();
  const prevRef = useRef<Map<string, PrevState>>(new Map());

  useEffect(() => {
    for (const inst of instances) {
      const prev = prevRef.current.get(inst.id);

      // If the session stopped (process exit, takeover, etc.) without hitting
      // idle/error, the awaiting-reply flag would otherwise stay armed and
      // attach to a future unrelated turn end. Drop it now.
      if (prev?.status === "processing" && inst.status === "stopped") {
        clearUserAwaitingReply(inst.id);
        continue;
      }

      // Only fire on processing → idle/error transition (turn end). Skip
      // first-seen instances so historical idle sessions don't spam on load.
      const wasProcessing = prev?.status === "processing";
      const isTurnEnd = inst.status === "idle" || inst.status === "error";
      if (!wasProcessing || !isTurnEnd) continue;

      // Pending tool/permission means the agent is awaiting user action, not
      // truly "ready" — that is the terminal-pending toast's category. Don't
      // consume the awaiting-reply flag yet; the real turn-end is still ahead.
      if (inst.pendingTool || inst.pendingPermission) continue;

      // External (terminal) sessions don't have a Relay-driven turn lifecycle.
      if (inst.external) continue;

      // Only notify if the user actually sent a message to this chat. Multi-
      // turn loops within a single user message stay in "processing"; this
      // filter additionally guards against non-user-driven idle transitions
      // (resumes, revives, etc.) that happen to flip status.
      if (!consumeUserAwaitingReply(inst.id)) continue;

      const isVisible = typeof document === "undefined" || document.visibilityState === "visible";
      const isFocused = inst.id === currentId && isVisible;
      if (isFocused) continue;

      const route = getInstanceChatRoute(inst);
      const providerLabel = getProviderDisplayName(inst.provider);
      const description =
        inst.status === "error"
          ? `${providerLabel} stopped with an error`
          : `${providerLabel} has finished responding`;
      const fn = inst.status === "error" ? toast.error : toast.success;
      fn(inst.name, {
        description,
        action: {
          label: "View",
          onClick: () => {
            window.focus();
            navigate(route);
          },
        },
      });
    }

    const next = new Map<string, PrevState>();
    for (const inst of instances) {
      next.set(inst.id, { status: inst.status });
    }
    prevRef.current = next;
  }, [instances, currentId, navigate]);
}
