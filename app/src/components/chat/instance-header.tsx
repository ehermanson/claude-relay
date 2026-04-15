/**
 * Header bar for the chat instance view — status dot, title, metadata,
 * and action buttons (open-in, debug, sidecar toggles).
 */

import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bug,
  Columns2,
  EllipsisVertical,
  FileText,
  GitBranch,
  LayoutGrid,
  ListChecks,
  ScrollText,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { Tooltip } from "../ui/tooltip";
import { Menu } from "../ui/menu";
import { GitBadge } from "../ui/git-badge";
import { ViewHeader, ViewHeaderTitle, MobileSidebarToggle } from "../ui/view-header";
import { ProjectBreadcrumb } from "../ui/project-breadcrumb";
import { OpenInMenu } from "../project/open-in-menu";
import { HeaderContextToggle, HeaderIconSkeleton } from "./header-actions";
import { CommitMessageDialog } from "../git/commit-message-dialog";
import { useProjectContext } from "@/context/project-context";
import { getInstanceProjectRouteId, getProjectName } from "../../lib/project-route";
import {
  fetchInstanceGitStatus,
  fetchInstanceHistory,
  gitCommitInstance,
  gitPushInstance,
} from "../../lib/api";
import { extractPrimaryTaskIdFromHistory } from "../../lib/task-links";
import { deriveInstanceStatusPresentation } from "../../lib/utils";
import type { InstanceInfo, ProviderNotice, SessionStats } from "@shared/types";
import type { SidecarTab } from "./sidecar";
import "./instance-header.css";

// ── Sidecar toggle buttons ───────────────────────────────────────────

interface SidecarTogglesProps {
  loading?: boolean;
  isMobile: boolean;
  activePanels: Set<SidecarTab>;
  tasksCount: number;
  filesCount: number;
  hasPlanContent: boolean;
  hasStats: boolean;
  stats?: SessionStats;
  sidecarContentCount: number;
  onTogglePanel: (panel: SidecarTab) => void;
  onOpenMobileSidecar: () => void;
}

function CountBadge({ count }: { count: number }) {
  return (
    <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 text-[0.5625rem] font-semibold leading-none text-white">
      {count}
    </span>
  );
}

function SidecarToggles({
  loading = false,
  isMobile,
  activePanels,
  tasksCount,
  filesCount,
  hasPlanContent,
  hasStats,
  stats,
  sidecarContentCount,
  onTogglePanel,
  onOpenMobileSidecar,
}: SidecarTogglesProps) {
  const hasTasksContent = tasksCount > 0;
  const hasFilesContent = filesCount > 0;
  const hasAny = hasTasksContent || hasFilesContent || hasPlanContent || hasStats;
  if (!loading && !hasAny) return null;

  return (
    <>
      {/* Desktop: per-panel toggle buttons */}
      {!isMobile &&
        (loading ? (
          <>
            <HeaderIconSkeleton />
            <HeaderIconSkeleton />
          </>
        ) : (
          <>
            {hasTasksContent && (
              <Tooltip content={activePanels.has("tasks") ? "Hide tasks" : "Show tasks"}>
                <Button
                  variant="icon"
                  toggled={activePanels.has("tasks")}
                  onClick={() => onTogglePanel("tasks")}
                  className="relative shrink-0"
                >
                  <ListChecks size={15} strokeWidth={2} />
                  <CountBadge count={tasksCount} />
                </Button>
              </Tooltip>
            )}
            {hasFilesContent && (
              <Tooltip content={activePanels.has("files") ? "Hide files" : "Show files"}>
                <Button
                  variant="icon"
                  toggled={activePanels.has("files")}
                  onClick={() => onTogglePanel("files")}
                  className="relative shrink-0"
                >
                  <FileText size={15} strokeWidth={2} />
                  <CountBadge count={filesCount} />
                </Button>
              </Tooltip>
            )}
            {hasPlanContent && (
              <Tooltip content={activePanels.has("plan") ? "Hide plan" : "Show plan"}>
                <Button
                  variant="icon"
                  toggled={activePanels.has("plan")}
                  onClick={() => onTogglePanel("plan")}
                  className="shrink-0"
                >
                  <ScrollText size={15} strokeWidth={2} />
                </Button>
              </Tooltip>
            )}
            {hasStats && (
              <HeaderContextToggle
                stats={stats}
                active={activePanels.has("context")}
                tooltip={activePanels.has("context") ? "Hide context" : "Show context"}
                onClick={() => onTogglePanel("context")}
              />
            )}
          </>
        ))}
      {/* Mobile: single sidecar button */}
      {isMobile &&
        (loading ? (
          <HeaderIconSkeleton />
        ) : (
          sidecarContentCount > 0 && (
            <Tooltip content="Sidecar">
              <Button
                variant="icon"
                onClick={onOpenMobileSidecar}
                className="relative h-9 w-9 shrink-0 rounded-lg"
              >
                <LayoutGrid size={17} strokeWidth={2} />
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-claude px-0.5 text-[0.5625rem] font-semibold leading-none text-white">
                  {sidecarContentCount}
                </span>
              </Button>
            </Tooltip>
          )
        ))}
    </>
  );
}

// ── Header ───────────────────────────────────────────────────────────

interface InstanceHeaderProps {
  instance: InstanceInfo;
  isMobile: boolean;
  activePanels: Set<SidecarTab>;
  tasksCount: number;
  filesCount: number;
  hasPlanContent: boolean;
  hasStats: boolean;
  sidecarContentCount: number;
  loadingSidecarActions?: boolean;
  onTogglePanel: (panel: SidecarTab) => void;
  onOpenDebug: () => void;
  onDelete?: () => void;
  onOpenMobileSidecar: () => void;
  onSplit?: () => void;
  /** Toggle embedded terminal panel. */
  onToggleTerminal?: () => void;
  /** Whether the terminal panel is currently open. */
  terminalOpen?: boolean;
}

function shouldPromoteProviderNotice(notice: ProviderNotice | undefined): boolean {
  if (!notice) return false;
  if (notice.code === "auth_required") return false;
  if (notice.source === "account/read") return false;
  return notice.source === "configWarning" || notice.source === "deprecationNotice";
}

type InstanceGitStatus = Awaited<ReturnType<typeof fetchInstanceGitStatus>>;

interface PushBranchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch?: string;
  status: InstanceGitStatus | null;
  statusError: string | null;
  pushing: boolean;
  onConfirm: (commitMessage?: string) => void;
}

function PushBranchDialog({
  open,
  onOpenChange,
  branch,
  status,
  statusError,
  pushing,
  onConfirm,
}: PushBranchDialogProps) {
  const [commitMessage, setCommitMessage] = useState("");
  const changeCount = status?.changeCount ?? 0;
  const hasUncommittedChanges = changeCount > 0;
  const canConfirm = !pushing && (!hasUncommittedChanges || commitMessage.trim().length > 0);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setCommitMessage("");
    onOpenChange(nextOpen);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      {open && (
        <Dialog.Content maxWidth="max-w-md">
          <Dialog.Header>
            <Dialog.Title>Push Branch?</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <div className="space-y-3 text-[0.8125rem] text-muted">
            <p>
              Push <span className="font-medium text-text">{branch || "the current branch"}</span>{" "}
              to its remote.
            </p>
            {!status && !statusError ? <p>Checking working tree…</p> : null}
            {statusError ? <p className="text-warning">{statusError}</p> : null}
            {status ? (
              <p>
                {hasUncommittedChanges
                  ? `${changeCount} uncommitted ${changeCount === 1 ? "change" : "changes"} will be committed before pushing.`
                  : "No uncommitted changes detected."}
                {status.aheadBehind.ahead > 0
                  ? ` ${status.aheadBehind.ahead} local ${status.aheadBehind.ahead === 1 ? "commit is" : "commits are"} ahead of upstream.`
                  : ""}
              </p>
            ) : null}
            {hasUncommittedChanges ? (
              <div className="space-y-1.5">
                <label
                  className="text-[0.75rem] font-medium text-muted"
                  htmlFor="push-commit-message-input"
                >
                  Commit message
                </label>
                <Input
                  id="push-commit-message-input"
                  autoFocus
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && canConfirm) onConfirm(commitMessage.trim());
                  }}
                  placeholder="Describe changes before pushing"
                />
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!canConfirm || (!status && !statusError)}
                onClick={() => onConfirm(hasUncommittedChanges ? commitMessage.trim() : undefined)}
              >
                {pushing ? "Pushing…" : hasUncommittedChanges ? "Commit & Push" : "Push Branch"}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      )}
    </Dialog.Root>
  );
}

export function InstanceHeader({
  instance,
  isMobile,
  activePanels,
  tasksCount,
  filesCount,
  hasPlanContent,
  hasStats,
  sidecarContentCount,
  loadingSidecarActions = false,
  onTogglePanel,
  onOpenDebug,
  onDelete,
  onOpenMobileSidecar,
  onSplit,
  onToggleTerminal,
  terminalOpen,
}: InstanceHeaderProps) {
  const navigate = useNavigate();
  const { artifacts } = useProjectContext();
  const displayBranch = instance.gitInfo?.branch || instance.gitBranch;

  const instanceStatus = deriveInstanceStatusPresentation(instance);

  const projectId = getInstanceProjectRouteId(instance);
  const displayBranchName = displayBranch || undefined;
  const providerNotices = instance.providerStatus?.notices ?? [];
  const latestProviderNotice = providerNotices[providerNotices.length - 1];
  const promotedProviderNotice = shouldPromoteProviderNotice(latestProviderNotice)
    ? latestProviderNotice
    : null;
  const reroutedModel = instance.providerStatus?.effectiveModel;
  const rerouteSource = instance.providerStatus?.reroutedFromModel;

  const queryClient = useQueryClient();
  const invalidateGitStatus = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["instance-git-status", instance.id] }),
    [queryClient, instance.id],
  );

  // Lightweight git status query for the badge indicators
  const { data: gitStatus, isLoading: gitStatusLoading } = useQuery({
    queryKey: ["instance-git-status", instance.id],
    queryFn: () => fetchInstanceGitStatus(instance.id),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    // Only fetch when we have a branch (instance is in a git repo)
    enabled: !!displayBranch,
  });

  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [pushDialogOpen, setPushDialogOpen] = useState(false);
  const [pushStatus, setPushStatus] = useState<InstanceGitStatus | null>(null);
  const [pushStatusError, setPushStatusError] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const { data: linkedTaskId = null } = useQuery({
    queryKey: ["instance-linked-task", instance.id, instance.lastActivityAt],
    queryFn: async () => {
      const history = await fetchInstanceHistory(instance.id);
      return extractPrimaryTaskIdFromHistory(history);
    },
    enabled: Boolean(artifacts.tasks?.length),
  });
  const linkedTask = artifacts.tasks?.find((task) => task.id === linkedTaskId) ?? null;

  const handleCommit = async (message: string) => {
    const result = await gitCommitInstance(instance.id, { message });
    if (result.success) {
      toast.success("Changes committed");
      invalidateGitStatus();
    } else {
      toast.error(result.error || "Commit failed");
    }
  };

  const openPushDialog = () => {
    setPushDialogOpen(true);
    setPushStatus(null);
    setPushStatusError(null);
    fetchInstanceGitStatus(instance.id)
      .then(setPushStatus)
      .catch((err) => {
        setPushStatusError(err instanceof Error ? err.message : "Failed to read git status");
      });
  };

  const handlePush = async (commitMessage?: string) => {
    setPushing(true);
    try {
      const result = await gitPushInstance(instance.id, {
        branch: displayBranchName,
        setUpstream: true,
        commitMessage,
      });
      if (!result.success) {
        toast.error(result.error || "Push failed");
        return;
      }
      setPushDialogOpen(false);
      invalidateGitStatus();
      if (result.pushed === false) {
        toast.warning(result.message || "Nothing to push");
        return;
      }
      toast.success(commitMessage ? "Changes committed and branch pushed" : "Branch pushed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Push failed");
    } finally {
      setPushing(false);
    }
  };

  const moreMenu = (
    <Menu.Root>
      <Menu.Trigger className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-all duration-150 hover:bg-surface-hover hover:text-text sm:h-7 sm:w-7 sm:rounded-md">
        <EllipsisVertical size={isMobile ? 18 : 14} />
      </Menu.Trigger>
      <Menu.Content>
        {onSplit && !isMobile && (
          <Menu.Item onClick={onSplit}>
            <Columns2 size={13} strokeWidth={2} className="text-muted" />
            Split view
          </Menu.Item>
        )}
        <Menu.Item onClick={onOpenDebug}>
          <Bug size={13} strokeWidth={2} className="text-muted" />
          Debug
        </Menu.Item>
        {onDelete && (
          <>
            <Menu.Separator />
            <Menu.Item danger onClick={onDelete}>
              <Trash2 size={13} />
              Delete chat
            </Menu.Item>
          </>
        )}
      </Menu.Content>
    </Menu.Root>
  );

  if (isMobile) {
    return (
      <ViewHeader style={{ containerName: "chat-header", containerType: "inline-size" }}>
        <MobileSidebarToggle />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[0.875rem] font-semibold leading-snug tracking-tight text-text-bright">
            {instance.name}
          </h1>
          <div className="flex items-center gap-1 text-[0.6875rem] leading-tight text-muted">
            <ProjectBreadcrumb
              projectId={projectId}
              label={getProjectName(instance.workingDirectory)}
              mobile
            />
            {linkedTask ? (
              <>
                <span className="text-border">·</span>
                <button
                  type="button"
                  onClick={() =>
                    navigate({
                      to: "/projects/$projectId/tasks",
                      params: { projectId },
                      search: { task: linkedTask.id },
                    })
                  }
                  className="inline-flex max-w-[13rem] items-center gap-1 rounded-md border border-border/70 bg-panel px-1.5 py-0.5 text-[0.625rem] font-medium text-muted transition-colors hover:border-accent/40 hover:text-text"
                >
                  <ListChecks size={10} />
                  <span className="truncate">{linkedTask.title}</span>
                </button>
              </>
            ) : null}
            {displayBranchName ? (
              <>
                <span className="text-border">·</span>
                <span className="flex items-center gap-0.5 truncate">
                  <GitBranch size={10} strokeWidth={2} className="shrink-0" />
                  <span className="truncate">{displayBranchName}</span>
                </span>
              </>
            ) : null}
          </div>
        </div>
        <SidecarToggles
          loading={loadingSidecarActions}
          isMobile={isMobile}
          activePanels={activePanels}
          tasksCount={tasksCount}
          filesCount={filesCount}
          hasPlanContent={hasPlanContent}
          hasStats={hasStats}
          stats={instance.stats}
          sidecarContentCount={sidecarContentCount}
          onTogglePanel={onTogglePanel}
          onOpenMobileSidecar={onOpenMobileSidecar}
        />
        <CommitMessageDialog
          open={commitDialogOpen}
          onOpenChange={setCommitDialogOpen}
          onCommit={(msg) => void handleCommit(msg)}
        />
        <PushBranchDialog
          open={pushDialogOpen}
          onOpenChange={setPushDialogOpen}
          branch={displayBranchName}
          status={pushStatus}
          statusError={pushStatusError}
          pushing={pushing}
          onConfirm={(commitMessage) => void handlePush(commitMessage)}
        />
      </ViewHeader>
    );
  }

  return (
    <ViewHeader style={{ containerName: "chat-header", containerType: "inline-size" }}>
      <MobileSidebarToggle />
      <span className="chat-header-breadcrumb contents">
        <ProjectBreadcrumb
          projectId={projectId}
          label={getProjectName(instance.workingDirectory)}
        />
      </span>
      <Tooltip content={instanceStatus.label}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${instanceStatus.dotClass}`} />
      </Tooltip>
      <ViewHeaderTitle>
        <h1 className="truncate text-sm font-semibold tracking-tight text-text-bright">
          {instance.name}
        </h1>
        <span className="chat-header-badge contents">
          {linkedTask ? (
            <button
              type="button"
              onClick={() =>
                navigate({
                  to: "/projects/$projectId/tasks",
                  params: { projectId },
                  search: { task: linkedTask.id },
                })
              }
              className="inline-flex max-w-[16rem] items-center gap-1 rounded-md border border-border/70 bg-panel px-2 py-0.5 text-[0.6875rem] font-medium text-muted transition-colors hover:border-accent/40 hover:text-text"
            >
              <ListChecks size={11} />
              <span className="truncate">{linkedTask.title}</span>
            </button>
          ) : null}
          {promotedProviderNotice ? (
            <Tooltip
              content={
                <div className="max-w-64">
                  <div className="font-medium">{promotedProviderNotice.message}</div>
                  {promotedProviderNotice.detail ? (
                    <div className="mt-1 text-muted">{promotedProviderNotice.detail}</div>
                  ) : null}
                </div>
              }
            >
              <span className="inline-flex items-center gap-1 rounded-md border border-warning/25 bg-warning/10 px-2 py-0.5 text-[0.6875rem] font-medium text-warning">
                <AlertTriangle size={11} />
                Notice
              </span>
            </Tooltip>
          ) : null}
          {reroutedModel && rerouteSource && reroutedModel !== rerouteSource ? (
            <Tooltip content={`Codex rerouted ${rerouteSource} to ${reroutedModel}`}>
              <span className="inline-flex items-center rounded-md border border-border/70 bg-panel px-2 py-0.5 text-[0.6875rem] font-medium text-muted">
                {reroutedModel}
              </span>
            </Tooltip>
          ) : null}
        </span>
        {moreMenu}
      </ViewHeaderTitle>
      <div className="flex items-center gap-1">
        <OpenInMenu path={instance.workingDirectory} className="hidden sm:flex" />
        {displayBranch && !isMobile && (
          <GitBadge
            branch={displayBranch}
            projectId={instance.gitInfo?.isWorktree ? undefined : projectId}
            dirty={gitStatus?.dirty}
            ahead={gitStatus?.aheadBehind?.ahead}
            behind={gitStatus?.aheadBehind?.behind}
            statusLoading={gitStatusLoading}
            onCommit={gitStatus?.dirty ? () => setCommitDialogOpen(true) : undefined}
            onPush={openPushDialog}
          />
        )}
        {onToggleTerminal && !isMobile && (
          <Tooltip content={terminalOpen ? "Hide terminal" : "Show terminal"}>
            <Button
              variant="icon"
              toggled={terminalOpen}
              onClick={onToggleTerminal}
              className="shrink-0"
            >
              <TerminalSquare size={15} strokeWidth={2} />
            </Button>
          </Tooltip>
        )}
        <CommitMessageDialog
          open={commitDialogOpen}
          onOpenChange={setCommitDialogOpen}
          onCommit={(msg) => void handleCommit(msg)}
        />
        <PushBranchDialog
          open={pushDialogOpen}
          onOpenChange={setPushDialogOpen}
          branch={displayBranchName}
          status={pushStatus}
          statusError={pushStatusError}
          pushing={pushing}
          onConfirm={(commitMessage) => void handlePush(commitMessage)}
        />
        <SidecarToggles
          loading={loadingSidecarActions}
          isMobile={isMobile}
          activePanels={activePanels}
          tasksCount={tasksCount}
          filesCount={filesCount}
          hasPlanContent={hasPlanContent}
          hasStats={hasStats}
          stats={instance.stats}
          sidecarContentCount={sidecarContentCount}
          onTogglePanel={onTogglePanel}
          onOpenMobileSidecar={onOpenMobileSidecar}
        />
      </div>
    </ViewHeader>
  );
}
