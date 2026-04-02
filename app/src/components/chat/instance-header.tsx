/**
 * Header bar for the chat instance view — status dot, title, metadata,
 * and action buttons (open-in, debug, sidecar toggles).
 */

import { useState } from "react";
import {
  Bug,
  Columns2,
  EllipsisVertical,
  FileText,
  LayoutGrid,
  ListChecks,
  ScrollText,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import { Menu } from "../ui/menu";
import { GitMenu } from "../ui/git-menu";
import {
  ViewHeader,
  ViewHeaderBreadcrumb,
  ViewHeaderTitle,
  BranchBadge,
  TokenBadge,
  MobileSidebarToggle,
} from "../ui/view-header";
import { OpenInMenu } from "../project/open-in-menu";
import { HeaderContextToggle, HeaderIconSkeleton } from "./header-actions";
import { CommitMessageDialog } from "../git/commit-message-dialog";
import { getInstanceProjectRouteId, getProjectName } from "../../lib/project-route";
import { gitCommitInstance, gitPushInstance } from "../../lib/api";
import { formatTokens, getDisplaySessionStats } from "../../lib/utils";
import type { InstanceInfo, SessionStats } from "@shared/types";
import type { SidecarTab } from "./sidecar";
import "./instance-header.css";

// ── Sidecar toggle buttons ───────────────────────────────────────────

interface SidecarTogglesProps {
  loading?: boolean;
  isMobile: boolean;
  activePanels: Set<SidecarTab>;
  hasTasksContent: boolean;
  hasFilesContent: boolean;
  hasPlanContent: boolean;
  hasStats: boolean;
  stats?: SessionStats;
  sidecarContentCount: number;
  onTogglePanel: (panel: SidecarTab) => void;
  onOpenMobileSidecar: () => void;
}

function SidecarToggles({
  loading = false,
  isMobile,
  activePanels,
  hasTasksContent,
  hasFilesContent,
  hasPlanContent,
  hasStats,
  stats,
  sidecarContentCount,
  onTogglePanel,
  onOpenMobileSidecar,
}: SidecarTogglesProps) {
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
                  className="shrink-0"
                >
                  <ListChecks size={15} strokeWidth={2} />
                </Button>
              </Tooltip>
            )}
            {hasFilesContent && (
              <Tooltip content={activePanels.has("files") ? "Hide files" : "Show files"}>
                <Button
                  variant="icon"
                  toggled={activePanels.has("files")}
                  onClick={() => onTogglePanel("files")}
                  className="shrink-0"
                >
                  <FileText size={15} strokeWidth={2} />
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
              <Button variant="icon" onClick={onOpenMobileSidecar} className="relative shrink-0">
                <LayoutGrid size={15} strokeWidth={2} />
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
  hasTasksContent: boolean;
  hasFilesContent: boolean;
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

export function InstanceHeader({
  instance,
  isMobile,
  activePanels,
  hasTasksContent,
  hasFilesContent,
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
  const isStopped = instance.status === "stopped";
  const displayBranch = instance.gitInfo?.branch || instance.gitBranch;
  const displayBranchIsWorktree =
    instance.gitInfo?.isWorktree ?? Boolean(instance.originalDirectory && displayBranch);

  // Status dot + label
  let dotClass: string;
  let statusLabel: string;
  if (isStopped) {
    dotClass = "bg-muted";
    statusLabel = instance.external ? "External chat (ended)" : "Ended";
  } else if (instance.status === "processing") {
    dotClass = "animate-pulse-dot bg-warning";
    statusLabel = instance.external ? "External chat (active)" : "Processing";
  } else if (instance.external) {
    dotClass = "bg-accent";
    statusLabel = "External chat";
  } else {
    dotClass = "bg-accent";
    statusLabel = "Idle";
  }

  const projectId = getInstanceProjectRouteId(instance);
  const displayStats = instance.stats
    ? getDisplaySessionStats(instance.provider, instance.stats)
    : null;
  const totalTokens = displayStats?.totalTokens ?? 0;
  const displayBranchName = displayBranch || undefined;

  const [commitDialogOpen, setCommitDialogOpen] = useState(false);

  const handleCommit = async (message: string) => {
    const result = await gitCommitInstance(instance.id, { message });
    if (result.success) {
      toast.success("Changes committed");
    } else {
      toast.error(result.error || "Commit failed");
    }
  };

  const handlePush = async () => {
    const result = await gitPushInstance(instance.id, {
      branch: displayBranchName,
      setUpstream: true,
    });
    if (!result.success) {
      toast.error(result.error || "Push failed");
      return;
    }
    toast.success("Pushed successfully");
  };

  return (
    <ViewHeader style={{ containerName: "chat-header", containerType: "inline-size" }}>
      <MobileSidebarToggle />
      <span className="chat-header-breadcrumb contents">
        <ViewHeaderBreadcrumb
          to="/projects/$projectId/chats"
          params={{ projectId }}
          label={getProjectName(instance.workingDirectory)}
        />
      </span>
      <Tooltip content={statusLabel}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
      </Tooltip>
      <ViewHeaderTitle>
        <h1 className="truncate text-sm font-semibold tracking-tight text-text-bright">
          {instance.name}
        </h1>
        <span className="chat-header-badge contents">
          {displayBranch && (
            <BranchBadge
              branch={displayBranch}
              tooltip={
                displayBranchIsWorktree
                  ? `Working in worktree on branch ${displayBranch}${instance.originalDirectory ? ` (from ${instance.originalDirectory})` : ""}`
                  : `On branch ${displayBranch}`
              }
            />
          )}
          <TokenBadge
            tokens={totalTokens}
            label="Session"
            tooltip={
              instance.stats ? (
                <div className="flex flex-col gap-0.5">
                  <div className="font-medium">Session usage</div>
                  <div className="text-muted">{instance.stats.model ?? "Unknown model"}</div>
                  <div>Total: {formatTokens(totalTokens)}</div>
                  <div>Input: {formatTokens(displayStats?.inputTokens ?? 0)}</div>
                  <div>Output: {formatTokens(instance.stats.outputTokens)}</div>
                  <div>Cache write: {formatTokens(instance.stats.cacheCreationTokens)}</div>
                  <div>Cache read: {formatTokens(instance.stats.cacheReadTokens)}</div>
                </div>
              ) : undefined
            }
          />
        </span>
        <Menu.Root>
          <Menu.Trigger className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-all duration-150 hover:bg-surface-hover hover:text-text">
            <EllipsisVertical size={14} />
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
      </ViewHeaderTitle>
      <div className="flex items-center gap-1">
        <OpenInMenu path={instance.workingDirectory} className="hidden sm:flex" />
        <GitMenu onCommit={() => setCommitDialogOpen(true)} onPush={handlePush} />
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
        <SidecarToggles
          loading={loadingSidecarActions}
          isMobile={isMobile}
          activePanels={activePanels}
          hasTasksContent={hasTasksContent}
          hasFilesContent={hasFilesContent}
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
