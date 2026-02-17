import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useWS } from "../context/WebSocketContext";

interface PrevState {
  pendingTool?: string;
}

/**
 * Watches all instances for pendingTool transitions
 * and fires a toast when a non-viewed session needs terminal attention.
 */
export function useTerminalPendingToasts(currentId?: string) {
  const { instances } = useWS();
  const navigate = useNavigate();
  const prevRef = useRef<Map<string, PrevState>>(new Map());

  useEffect(() => {
    for (const inst of instances) {
      if (inst.id === currentId) continue;
      const prev = prevRef.current.get(inst.id);

      // Pending tool approval (any instance type)
      if (inst.pendingTool && !prev?.pendingTool) {
        const instanceId = inst.id;
        toast.warning(inst.name, {
          description: `Waiting for approval to use ${inst.pendingTool}`,
          action: {
            label: "View",
            onClick: () => navigate({ to: "/chat/$id", params: { id: instanceId } }),
          },
        });
      }
    }
    // Update prev state
    const next = new Map<string, PrevState>();
    for (const inst of instances) {
      next.set(inst.id, {
        pendingTool: inst.pendingTool,
      });
    }
    prevRef.current = next;
  }, [instances, currentId, navigate]);
}
