import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Menu } from "@/components/ui/menu";
import { GitMenu } from "@/components/ui/git-menu";
import {
  ViewHeader,
  ViewHeaderBreadcrumb,
  ViewHeaderTitle,
  BranchBadge,
  TokenBadge,
  MobileSidebarToggle,
} from "@/components/ui/view-header";
import { HeaderContextToggle, HeaderIconSkeleton } from "@/components/chat/header-actions";
import { OpenInMenu } from "@/components/project/open-in-menu";
import { GhCliRequiredDialog } from "@/components/git/gh-cli-required-dialog";
import { CommitMessageDialog } from "@/components/git/commit-message-dialog";
import { useSpaceViewContext } from "@/components/spaces/space-view-context";
import {
  Archive,
  Bug,
  Check,
  EllipsisVertical,
  ExternalLink,
  FileText,
  GitBranch,
  LayoutGrid,
  Pencil,
  TerminalSquare,
} from "lucide-react";
import { formatTokens } from "@/lib/utils";

export function SpaceViewHeader() {
  const { shared, actions } = useSpaceViewContext();
  const totalTokens = shared.aggregatedStats
    ? shared.aggregatedStats.inputTokens +
      shared.aggregatedStats.outputTokens +
      shared.aggregatedStats.cacheCreationTokens +
      shared.aggregatedStats.cacheReadTokens
    : 0;

  return (
    <ViewHeader>
      <MobileSidebarToggle />
      <ViewHeaderBreadcrumb
        to="/projects/$projectId"
        params={{ projectId: shared.projectId }}
        label={shared.projectName}
      />
      <GitBranch size={14} className="shrink-0 text-accent" />
      <ViewHeaderTitle>
        {shared.editingSpaceName ? (
          <input
            ref={shared.spaceNameInputRef}
            value={shared.spaceNameDraft}
            onChange={(e) => actions.setSpaceNameDraft(e.target.value)}
            onBlur={actions.commitSpaceRename}
            onKeyDown={actions.handleSpaceNameKeyDown}
            className="w-[12rem] max-w-[40vw] rounded border border-border bg-surface px-2 py-0.5 text-sm font-semibold text-text-bright outline-none focus:border-accent"
          />
        ) : (
          <span className="truncate text-sm font-semibold text-text-bright">
            {shared.space.name}
          </span>
        )}
        {shared.space.gitBranch && <BranchBadge branch={shared.space.gitBranch} />}
        {shared.isMerged && (
          <Badge variant="success" size="sm">
            Merged
          </Badge>
        )}
        {shared.isBroken && (
          <Badge variant="warning" size="sm">
            Broken
          </Badge>
        )}
        {shared.isArchived && (
          <Badge variant="default" size="sm">
            Archived
          </Badge>
        )}
        {shared.isActive && shared.space.remoteStatus === "pr-open" && (
          <Badge
            variant="accent"
            size="sm"
            className={shared.space.prUrl ? "cursor-pointer" : ""}
            onClick={
              shared.space.prUrl ? () => window.open(shared.space.prUrl!, "_blank") : undefined
            }
          >
            PR open
            {shared.space.prUrl && <ExternalLink size={10} />}
          </Badge>
        )}
        {shared.isActive && shared.space.remoteStatus === "pushed" && (
          <Badge variant="accent" size="sm">
            Pushed
          </Badge>
        )}
        {shared.isActive && !shared.space.remoteStatus && (
          <Badge variant="default" size="sm">
            Local only
          </Badge>
        )}
        <TokenBadge
          tokens={totalTokens}
          label="Session"
          tooltip={
            shared.aggregatedStats ? (
              <div className="flex flex-col gap-0.5">
                <div className="font-medium">Space usage</div>
                <div className="text-muted">
                  Across {shared.spaceInstances.length} chat
                  {shared.spaceInstances.length !== 1 ? "s" : ""}
                </div>
                <div>Total: {formatTokens(totalTokens)}</div>
                <div>Input: {formatTokens(shared.aggregatedStats.inputTokens)}</div>
                <div>Output: {formatTokens(shared.aggregatedStats.outputTokens)}</div>
                <div>Cache write: {formatTokens(shared.aggregatedStats.cacheCreationTokens)}</div>
                <div>Cache read: {formatTokens(shared.aggregatedStats.cacheReadTokens)}</div>
              </div>
            ) : undefined
          }
        />
        <Menu.Root>
          <Menu.Trigger className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-all duration-150 hover:bg-surface-hover hover:text-text">
            <EllipsisVertical size={14} />
          </Menu.Trigger>
          <Menu.Content>
            {!shared.space.isDefault && (shared.isActive || shared.isBroken) && (
              <Menu.Item onClick={actions.startRenamingSpace}>
                <Pencil size={13} strokeWidth={2} className="text-muted" />
                Rename
              </Menu.Item>
            )}
            <Menu.Item onClick={() => actions.setShowDebug(true)}>
              <Bug size={13} strokeWidth={2} className="text-muted" />
              Debug
            </Menu.Item>
            {!shared.space.isDefault && shared.isActive && (
              <Menu.Item onClick={() => void actions.handleMarkMerged()}>
                <Check size={13} strokeWidth={2} className="text-muted" />
                Mark as merged
              </Menu.Item>
            )}
            {!shared.space.isDefault && (shared.isActive || shared.isBroken) && (
              <>
                <Menu.Separator />
                <Menu.Item danger onClick={() => actions.setConfirmDelete(true)}>
                  <Archive size={13} />
                  Archive space
                </Menu.Item>
              </>
            )}
          </Menu.Content>
        </Menu.Root>
      </ViewHeaderTitle>

      <div className="flex items-center gap-1.5">
        {shared.isActive && (
          <>
            <OpenInMenu path={shared.openInPath} className="hidden sm:flex" />
            <GitMenu
              onCommit={() => actions.setCommitDialogOpen(true)}
              onMerge={() => actions.setMergeDialog({ phase: "confirm" })}
              mergeDisabled={shared.spaceInstances.length === 0}
              onPush={() => void actions.handlePush(false)}
              onPushAndCreatePR={() => void actions.handlePush(true)}
              worktreePath={shared.space.worktreePath || undefined}
            />
            {!shared.isMobile && (
              <Tooltip
                content={
                  shared.showTerminalPanel || shared.isTerminalCollapsed
                    ? "Hide terminal"
                    : "Show terminal"
                }
              >
                <Button
                  variant="icon"
                  toggled={shared.showTerminalPanel || shared.isTerminalCollapsed}
                  onClick={actions.handleToggleTerminal}
                  className="shrink-0"
                >
                  <TerminalSquare size={15} strokeWidth={2} />
                </Button>
              </Tooltip>
            )}
          </>
        )}
        <CommitMessageDialog
          open={shared.commitDialogOpen}
          onOpenChange={actions.setCommitDialogOpen}
          onCommit={(message) => void actions.handleCommit(message)}
        />
        <GhCliRequiredDialog
          open={shared.ghCliDialogOpen}
          onOpenChange={actions.setGhCliDialogOpen}
          reason={shared.ghCliReason}
        />

        {(shared.spaceInstances.length > 0 || shared.chatSummariesLoading) && (
          <>
            {shared.chatSummariesLoading && shared.spaceInstances.length === 0 ? (
              <>
                <HeaderIconSkeleton />
                <HeaderIconSkeleton />
              </>
            ) : shared.isMobile ? (
              shared.sidecarContentCount > 0 && (
                <Tooltip content="Sidecar">
                  <Button
                    variant="icon"
                    onClick={() => actions.setSidecarMobileOpen(true)}
                    className="relative shrink-0"
                  >
                    <LayoutGrid size={15} strokeWidth={2} />
                    <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-claude px-0.5 text-[0.5625rem] font-semibold leading-none text-white">
                      {shared.sidecarContentCount}
                    </span>
                  </Button>
                </Tooltip>
              )
            ) : (
              <>
                <Tooltip content={shared.activePanels.has("files") ? "Hide files" : "Show files"}>
                  <Button
                    variant="icon"
                    toggled={shared.activePanels.has("files")}
                    onClick={() => actions.togglePanel("files")}
                    className="relative shrink-0"
                  >
                    <FileText size={15} strokeWidth={2} />
                    {shared.fileChanges.length > 0 && (
                      <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 text-[0.5625rem] font-semibold leading-none text-white">
                        {shared.fileChanges.length}
                      </span>
                    )}
                  </Button>
                </Tooltip>
                <HeaderContextToggle
                  stats={shared.activeLiveInstance?.stats}
                  active={shared.activePanels.has("context")}
                  tooltip={shared.activePanels.has("context") ? "Hide context" : "Show context"}
                  onClick={() => actions.togglePanel("context")}
                />
              </>
            )}
          </>
        )}
      </div>
    </ViewHeader>
  );
}
