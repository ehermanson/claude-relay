import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  GitBranch,
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  Check,
  Cloud,
  Loader2,
} from "lucide-react";
import { fetchBranches, checkoutBranch, gitFetch, gitPull, gitPush } from "../../lib/api";
import { Popover } from "../ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "../ui/command";
import { Tooltip } from "../ui/tooltip";

// ─── Types ──────────────────────────────────────────────────────────────────

interface GitStatusBarProps {
  projectId: string;
}

// ─── Branch Selector ────────────────────────────────────────────────────────

function BranchSelector({
  projectId,
  current,
  onBranchChanged,
}: {
  projectId: string;
  current: string | null;
  onBranchChanged: () => void;
}) {
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["branches", projectId],
    queryFn: () => fetchBranches(projectId),
    enabled: open,
    staleTime: 5000,
  });

  const handleSelect = useCallback(
    async (branch: string) => {
      if (branch === current) {
        setOpen(false);
        return;
      }
      try {
        await checkoutBranch(projectId, branch);
        toast.success(`Switched to ${branch}`);
        onBranchChanged();
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to switch branch");
      }
    },
    [projectId, current, onBranchChanged],
  );

  const localBranches = data?.local ?? [];
  const remoteBranches = (data?.remote ?? []).filter((b) => !localBranches.includes(b));

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.75rem] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <GitBranch size={13} />
          <span className="max-w-[180px] truncate">{current || "HEAD"}</span>
        </button>
      </Popover.Trigger>
      <Popover.Content side="bottom" align="start" sideOffset={4} className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search branches..." />
          <CommandList>
            <CommandEmpty>No branches found</CommandEmpty>
            {localBranches.length > 0 && (
              <CommandGroup heading="Local">
                {localBranches.map((b) => (
                  <CommandItem key={b} onSelect={() => void handleSelect(b)}>
                    <GitBranch size={13} className="shrink-0 text-muted" />
                    <span className="truncate">{b}</span>
                    {b === current && <Check size={13} className="ml-auto shrink-0 text-accent" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {remoteBranches.length > 0 && (
              <CommandGroup heading="Remote">
                {remoteBranches.map((b) => (
                  <CommandItem key={`remote-${b}`} onSelect={() => void handleSelect(b)}>
                    <Cloud size={13} className="shrink-0 text-muted" />
                    <span className="truncate">{b}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </Popover.Content>
    </Popover.Root>
  );
}

// ─── Icon Button ────────────────────────────────────────────────────────────

function GitAction({
  icon: Icon,
  tooltip,
  loading,
  disabled,
  onClick,
}: {
  icon: typeof ArrowDownToLine;
  tooltip: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={tooltip}>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={onClick}
        className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
      </button>
    </Tooltip>
  );
}

// ─── Git Status Bar ─────────────────────────────────────────────────────────

export function GitStatusBar({ projectId }: GitStatusBarProps) {
  const queryClient = useQueryClient();
  const [fetchLoading, setFetchLoading] = useState(false);
  const [pullLoading, setPullLoading] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  const { data, refetch } = useQuery({
    queryKey: ["branches", projectId],
    queryFn: () => fetchBranches(projectId),
    refetchOnWindowFocus: true,
    staleTime: 15000,
  });

  // Refetch on visibility change (tab focus)
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        refetchRef.current();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["branches", projectId] });
  }, [queryClient, projectId]);

  const handleFetch = useCallback(async () => {
    setFetchLoading(true);
    try {
      const result = await gitFetch(projectId);
      if (result.success) {
        toast.success("Fetched from remote");
        invalidate();
      } else {
        toast.error(result.error || "Fetch failed");
      }
    } finally {
      setFetchLoading(false);
    }
  }, [projectId, invalidate]);

  const handlePull = useCallback(async () => {
    setPullLoading(true);
    try {
      const result = await gitPull(projectId);
      if (result.success) {
        toast.success("Pulled from remote");
        invalidate();
      } else {
        toast.error(result.error || "Pull failed");
      }
    } finally {
      setPullLoading(false);
    }
  }, [projectId, invalidate]);

  const current = data?.current ?? null;
  const ahead = data?.aheadBehind?.ahead ?? 0;
  const behind = data?.aheadBehind?.behind ?? 0;
  const dirty = data?.dirty ?? false;

  const handlePush = useCallback(async () => {
    setPushLoading(true);
    try {
      const result = await gitPush(projectId, {
        branch: current ?? undefined,
        setUpstream: true,
      });
      if (result.success) {
        toast.success("Pushed to remote");
        invalidate();
      } else {
        toast.error(result.error || "Push failed");
      }
    } finally {
      setPushLoading(false);
    }
  }, [projectId, invalidate, current]);

  return (
    <div className="flex items-center gap-1 border-b border-border/70 px-5 py-1">
      {/* Branch selector */}
      <BranchSelector projectId={projectId} current={current} onBranchChanged={invalidate} />

      {/* Dirty indicator */}
      {dirty && (
        <Tooltip content="Uncommitted changes">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
        </Tooltip>
      )}

      {/* Ahead/behind */}
      {(ahead > 0 || behind > 0) && (
        <div className="flex items-center gap-1.5 px-1 text-[0.6875rem] tabular-nums text-muted">
          {ahead > 0 && (
            <Tooltip content={`${ahead} commit${ahead !== 1 ? "s" : ""} ahead of remote`}>
              <span className="flex items-center gap-0.5">
                <ArrowUpFromLine size={11} />
                {ahead}
              </span>
            </Tooltip>
          )}
          {behind > 0 && (
            <Tooltip content={`${behind} commit${behind !== 1 ? "s" : ""} behind remote`}>
              <span className="flex items-center gap-0.5">
                <ArrowDownToLine size={11} />
                {behind}
              </span>
            </Tooltip>
          )}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Git actions */}
      <GitAction icon={RefreshCw} tooltip="Fetch" loading={fetchLoading} onClick={handleFetch} />
      <GitAction
        icon={ArrowDownToLine}
        tooltip="Pull"
        loading={pullLoading}
        disabled={behind === 0}
        onClick={handlePull}
      />
      <GitAction
        icon={ArrowUpFromLine}
        tooltip="Push"
        loading={pushLoading}
        disabled={ahead === 0}
        onClick={handlePush}
      />
    </div>
  );
}
