import { useEffect, useMemo, useRef, useState } from "react";
import type { InstanceInfo } from "@shared/types";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { useWSState, useWSMethods } from "@/context/websocket-context";
import { useProcessLimitStore } from "@/stores/process-limit-store";
import { deriveInstanceStatusPresentation, formatTimeAgo } from "@/lib/utils";

/**
 * Active managed sessions that count against the concurrent-process cap:
 * non-external and not stopped. (External sessions don't hold a relay process
 * slot, and stopped ones have already released theirs.)
 */
function selectActive(instances: InstanceInfo[]): InstanceInfo[] {
  return instances
    .filter((i) => !i.external && i.status !== "stopped")
    .sort((a, b) => a.lastActivityAt - b.lastActivityAt);
}

function projectLabel(instance: InstanceInfo): string {
  return instance.projectSlug || instance.workingDirectory.split("/").pop() || "—";
}

export function ProcessLimitDialog() {
  const { open, limit, pendingRetry, close } = useProcessLimitStore();
  const { instances } = useWSState();
  const { send } = useWSMethods();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stopping, setStopping] = useState(false);
  // Guards the auto-retry effect so the pending create only fires once.
  const firedRef = useRef(false);
  // Active count captured when the dialog opened — the effective cap to clear,
  // used as a fallback when the server-reported limit is unknown.
  const baselineRef = useRef(0);

  const active = useMemo(() => selectActive(instances), [instances]);
  const activeCount = active.length;
  // Only sessions with a saved session id can be paused & later resumed.
  const isStoppable = (i: InstanceInfo) => Boolean(i.sessionId);

  // Reset transient state each time the dialog opens.
  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setStopping(false);
      firedRef.current = false;
      baselineRef.current = activeCount;
    }
    // Intentionally only on `open` toggle — `activeCount` is sampled once here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Once a slot frees, close and auto-run the create that hit the cap.
  useEffect(() => {
    if (!open || firedRef.current) return;
    const cap = limit > 0 ? limit : baselineRef.current;
    if (cap > 0 && activeCount >= cap) return;
    firedRef.current = true;
    const retry = pendingRetry;
    close();
    if (retry) void retry();
  }, [open, activeCount, limit, pendingRetry, close]);

  if (!open) return null;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleStop = () => {
    if (selected.size === 0) return;
    setStopping(true);
    for (const id of selected) {
      send({ type: "stop_instance", instanceId: id });
    }
    // The dialog closes via the auto-retry effect once the stops land and the
    // active count drops below the cap.
  };

  return (
    <Dialog.Root open={open} onOpenChange={stopping ? () => {} : (o) => !o && close()}>
      <Dialog.Content maxWidth="max-w-lg">
        <Dialog.Header>
          <Dialog.Title>Session limit reached</Dialog.Title>
          {!stopping && <Dialog.Close />}
        </Dialog.Header>

        <p className="text-[0.8125rem] text-muted">
          You're running <span className="font-medium text-text">{activeCount}</span> of{" "}
          <span className="font-medium text-text">{limit || activeCount}</span> sessions. Pause one
          or more to free up capacity — paused chats stay in the sidebar and resume the next time
          you message them.
        </p>

        <div className="mt-1 flex max-h-[45vh] flex-col gap-1 overflow-y-auto">
          {active.map((inst) => {
            const status = deriveInstanceStatusPresentation(inst);
            const stoppable = isStoppable(inst);
            const checked = selected.has(inst.id);
            const row = (
              <label
                key={inst.id}
                className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                  stoppable
                    ? "cursor-pointer border-border/60 hover:bg-surface-hover"
                    : "cursor-not-allowed border-border/30 opacity-50"
                } ${checked ? "border-accent/60 bg-accent/5" : ""}`}
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 shrink-0 accent-accent"
                  checked={checked}
                  disabled={!stoppable || stopping}
                  onChange={() => toggle(inst.id)}
                />
                <span className={`h-2 w-2 shrink-0 rounded-full ${status.dotClass}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[0.8125rem] font-medium text-text">{inst.name}</div>
                  <div className="truncate text-[0.6875rem] text-muted">
                    {projectLabel(inst)} · {inst.provider} · {status.label} ·{" "}
                    {formatTimeAgo(inst.lastActivityAt)}
                  </div>
                </div>
              </label>
            );
            return stoppable ? (
              row
            ) : (
              <Tooltip
                key={inst.id}
                content="New chat — send a message before it can be paused"
                side="top"
              >
                {row}
              </Tooltip>
            );
          })}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[0.6875rem] text-muted">
            {selected.size > 0 ? `${selected.size} selected` : "Select sessions to pause"}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={close} disabled={stopping}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleStop}
              disabled={selected.size === 0 || stopping}
              className="gap-1.5"
            >
              {stopping && <Spinner size={12} className="text-current" />}
              Pause {selected.size > 0 ? selected.size : ""} {pendingRetry ? "& continue" : ""}
            </Button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
