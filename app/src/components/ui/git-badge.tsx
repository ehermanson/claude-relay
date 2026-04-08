/**
 * Combined git status badge + actions menu.
 * Replaces the separate BranchBadge + GitMenu pair in chat/space headers.
 *
 * Trigger shows: branch name, dirty dot, ahead/behind counts.
 * Menu shows: status summary, branch switcher (submenu), action items.
 */

import { useCallback, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronRight,
  Cloud,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Loader2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Menu } from "./menu";
import { fetchBranches, checkoutBranch } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────

interface GitBadgeAction {
  label: string;
  icon: ReactNode;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
}

interface GitBadgeProps {
  branch: string;

  /** Project ID — enables branch switching submenu when provided */
  projectId?: string;

  /** Uncommitted changes present */
  dirty?: boolean;
  /** Commits ahead of remote */
  ahead?: number;
  /** Commits behind remote */
  behind?: number;
  /** Whether status data is still loading */
  statusLoading?: boolean;

  // ── Actions (each optional — only rendered if provided) ──

  onCommit?: () => void | Promise<void>;
  onPush?: () => void | Promise<void>;
  onPushAndCreatePR?: () => void | Promise<void>;
  onMerge?: () => void | Promise<void>;
  mergeDisabled?: boolean;
  /** Path to copy (worktree directory) */
  worktreePath?: string;
  /** Extra actions appended at the end */
  extraActions?: GitBadgeAction[];
}

// ── Branch submenu content ───────────────────────────────────────────

function BranchSubmenu({
  projectId,
  current,
  onBranchChanged,
}: {
  projectId: string;
  current: string;
  onBranchChanged: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["branches", projectId],
    queryFn: () => fetchBranches(projectId),
    staleTime: 5000,
  });

  const handleSelect = useCallback(
    async (branch: string) => {
      if (branch === current) return;
      try {
        await checkoutBranch(projectId, branch);
        toast.success(`Switched to ${branch}`);
        onBranchChanged();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to switch branch");
      }
    },
    [projectId, current, onBranchChanged],
  );

  // Filter out space branches (relay-space/*) to avoid worktree conflicts
  const isSpaceBranch = (b: string) => b.startsWith("relay-space/");

  const localBranches = (data?.local ?? []).filter((b) => !isSpaceBranch(b));
  const remoteBranches = (data?.remote ?? []).filter(
    (b) => !localBranches.includes(b) && !isSpaceBranch(b),
  );

  if (isLoading) {
    return (
      <Menu.Item disabled>
        <Loader2 size={13} className="animate-spin text-muted" />
        Loading...
      </Menu.Item>
    );
  }

  return (
    <>
      {localBranches.map((b) => (
        <Menu.Item key={b} onClick={() => void handleSelect(b)}>
          <GitBranch size={13} className="text-muted" />
          <span className="flex-1 truncate">{b}</span>
          {b === current && <Check size={13} className="ml-auto shrink-0 text-accent" />}
        </Menu.Item>
      ))}
      {remoteBranches.length > 0 && (
        <>
          <Menu.Separator />
          <div className="px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted">
            Remote
          </div>
          {remoteBranches.map((b) => (
            <Menu.Item key={`remote-${b}`} onClick={() => void handleSelect(b)}>
              <Cloud size={13} className="text-muted" />
              <span className="truncate">{b}</span>
            </Menu.Item>
          ))}
        </>
      )}
    </>
  );
}

// ── Component ────────────────────────────────────────────────────────

export function GitBadge({
  branch,
  projectId,
  dirty,
  ahead = 0,
  behind = 0,
  statusLoading,
  onCommit,
  onPush,
  onPushAndCreatePR,
  onMerge,
  mergeDisabled,
  worktreePath,
  extraActions,
}: GitBadgeProps) {
  const queryClient = useQueryClient();

  const hasStatus = dirty !== undefined || ahead > 0 || behind > 0 || statusLoading;

  const handleBranchChanged = useCallback(() => {
    if (projectId) {
      queryClient.invalidateQueries({ queryKey: ["branches", projectId] });
    }
  }, [queryClient, projectId]);

  return (
    <Menu.Root>
      {/* ── Trigger badge ────────────────────────────────────── */}
      <Menu.Trigger className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/50 px-2 text-xs text-muted transition-all duration-150 hover:bg-surface-hover hover:text-text">
        <GitBranch size={13} />
        <span className="max-w-[140px] truncate">{branch}</span>

        {dirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}

        {ahead > 0 && (
          <span className="flex items-center gap-0.5 tabular-nums text-[0.625rem]">
            <ArrowUpFromLine size={9} />
            {ahead}
          </span>
        )}
        {behind > 0 && (
          <span className="flex items-center gap-0.5 tabular-nums text-[0.625rem]">
            <ArrowDownToLine size={9} />
            {behind}
          </span>
        )}
      </Menu.Trigger>

      {/* ── Menu content ─────────────────────────────────────── */}
      <Menu.Content side="bottom" align="end" sideOffset={4}>
        {/* Status section */}
        {hasStatus && (
          <>
            <div className="px-3 py-1.5">
              {statusLoading ? (
                <div className="flex items-center gap-2 text-[0.75rem] text-muted">
                  <Loader2 size={11} className="animate-spin" />
                  Checking...
                </div>
              ) : (
                <div className="flex flex-col gap-0.5 text-[0.75rem] text-muted">
                  {dirty && (
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                      Uncommitted changes
                    </div>
                  )}
                  {ahead > 0 && (
                    <div className="flex items-center gap-2">
                      <ArrowUpFromLine size={11} />
                      {ahead} commit{ahead !== 1 ? "s" : ""} ahead
                    </div>
                  )}
                  {behind > 0 && (
                    <div className="flex items-center gap-2">
                      <ArrowDownToLine size={11} />
                      {behind} commit{behind !== 1 ? "s" : ""} behind
                    </div>
                  )}
                  {!dirty && ahead === 0 && behind === 0 && (
                    <div className="text-muted/70">Up to date</div>
                  )}
                </div>
              )}
            </div>
            <Menu.Separator />
          </>
        )}

        {/* Branch switcher submenu */}
        {projectId && (
          <Menu.Sub>
            <Menu.SubTrigger>
              <GitBranch size={13} className="text-muted" />
              <span className="flex-1">Switch branch</span>
              <ChevronRight size={12} className="text-muted" />
            </Menu.SubTrigger>
            <Menu.SubContent className="max-h-[300px] w-56 overflow-y-auto">
              <BranchSubmenu
                projectId={projectId}
                current={branch}
                onBranchChanged={handleBranchChanged}
              />
            </Menu.SubContent>
          </Menu.Sub>
        )}

        {/* Actions */}
        {projectId && (onCommit || onPush || onPushAndCreatePR || onMerge) && <Menu.Separator />}

        {onMerge && (
          <>
            <Menu.Item onClick={() => void onMerge()} disabled={mergeDisabled}>
              <GitMerge size={13} className="text-muted" />
              Complete
            </Menu.Item>
            <Menu.Separator />
          </>
        )}
        {onCommit && (
          <Menu.Item onClick={() => void onCommit()}>
            <GitCommitHorizontal size={13} className="text-muted" />
            Commit changes
          </Menu.Item>
        )}
        {onPush && (
          <Menu.Item onClick={() => void onPush()}>
            <Upload size={13} className="text-muted" />
            Push branch
          </Menu.Item>
        )}
        {onPushAndCreatePR && (
          <Menu.Item onClick={() => void onPushAndCreatePR()}>
            <GitPullRequest size={13} className="text-muted" />
            Push & create PR
          </Menu.Item>
        )}
        {worktreePath && (
          <>
            <Menu.Separator />
            <Menu.Item
              onClick={() => {
                navigator.clipboard.writeText(worktreePath).then(() => {
                  toast.success("Copied to clipboard");
                });
              }}
            >
              <FolderOpen size={13} className="text-muted" />
              Copy working directory
            </Menu.Item>
          </>
        )}
        {extraActions?.map((action, i) => (
          <Menu.Item key={i} onClick={() => void action.onClick()} disabled={action.disabled}>
            {action.icon}
            {action.label}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
}
