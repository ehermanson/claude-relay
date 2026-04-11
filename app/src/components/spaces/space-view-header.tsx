import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Menu } from "@/components/ui/menu";
import { GitBadge } from "@/components/ui/git-badge";
import { ViewHeader, ViewHeaderTitle, MobileSidebarToggle } from "@/components/ui/view-header";
import { ProjectBreadcrumb } from "@/components/ui/project-breadcrumb";
import { HeaderContextToggle, HeaderIconSkeleton } from "@/components/chat/header-actions";
import { OpenInMenu } from "@/components/project/open-in-menu";
import { GhCliRequiredDialog } from "@/components/git/gh-cli-required-dialog";
import { CommitMessageDialog } from "@/components/git/commit-message-dialog";
import { useSpaceViewContext } from "@/components/spaces/space-view-context";
import {
  Archive,
  BookOpen,
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
import "./space-view-header.css";

export function SpaceViewHeader() {
  const { shared, actions } = useSpaceViewContext();

  // ── Mobile layout ──────────────────────────────────────────────────
  if (shared.isMobile) {
    return (
      <ViewHeader style={{ containerName: "space-header", containerType: "inline-size" }}>
        <MobileSidebarToggle />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[0.875rem] font-semibold leading-snug tracking-tight text-text-bright">
            {shared.space.name}
          </h1>
          <div className="flex items-center gap-1 text-[0.6875rem] leading-tight text-muted">
            <ProjectBreadcrumb projectId={shared.projectId} label={shared.projectName} mobile />
            {shared.space.gitBranch ? (
              <>
                <span className="text-border">·</span>
                <span className="flex items-center gap-0.5 truncate">
                  <GitBranch size={10} strokeWidth={2} className="shrink-0" />
                  <span className="truncate">{shared.space.gitBranch}</span>
                </span>
              </>
            ) : null}
          </div>
        </div>
        {shared.sidecarContentCount > 0 && (
          <Button
            variant="icon"
            onClick={() => actions.setSidecarMobileOpen(true)}
            className="relative h-9 w-9 shrink-0 rounded-lg"
          >
            <LayoutGrid size={17} strokeWidth={2} />
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-claude px-0.5 text-[0.5625rem] font-semibold leading-none text-white">
              {shared.sidecarContentCount}
            </span>
          </Button>
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
      </ViewHeader>
    );
  }

  // ── Desktop layout ─────────────────────────────────────────────────
  return (
    <ViewHeader style={{ containerName: "space-header", containerType: "inline-size" }}>
      <MobileSidebarToggle />
      <span className="space-header-breadcrumb contents">
        <ProjectBreadcrumb projectId={shared.projectId} label={shared.projectName} />
      </span>
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
        <span className="space-header-badge contents">
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
        </span>
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
            {shared.space.gitBranch && (
              <GitBadge
                branch={shared.space.gitBranch}
                onCommit={() => actions.setCommitDialogOpen(true)}
                onPush={() => void actions.handlePush(false)}
                onPushAndCreatePR={() => void actions.handlePush(true)}
                onMerge={() => actions.setMergeDialog({ phase: "confirm" })}
                mergeDisabled={shared.spaceInstances.length === 0}
                worktreePath={shared.space.worktreePath || undefined}
              />
            )}
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

        {!shared.space.isDefault && (
          <Tooltip content={shared.activePanels.has("brief") ? "Hide brief" : "Show brief"}>
            <Button
              variant="icon"
              toggled={shared.activePanels.has("brief")}
              onClick={() => actions.togglePanel("brief")}
              className="shrink-0"
            >
              <BookOpen size={15} strokeWidth={2} />
            </Button>
          </Tooltip>
        )}

        {(shared.spaceInstances.length > 0 || shared.chatSummariesLoading) && (
          <>
            {shared.chatSummariesLoading && shared.spaceInstances.length === 0 ? (
              <>
                <HeaderIconSkeleton />
                <HeaderIconSkeleton />
              </>
            ) : (
              <>
                {shared.fileChanges.length > 0 && (
                  <Tooltip content={shared.activePanels.has("files") ? "Hide files" : "Show files"}>
                    <Button
                      variant="icon"
                      toggled={shared.activePanels.has("files")}
                      onClick={() => actions.togglePanel("files")}
                      className="relative shrink-0"
                    >
                      <FileText size={15} strokeWidth={2} />
                      <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 text-[0.5625rem] font-semibold leading-none text-white">
                        {shared.fileChanges.length}
                      </span>
                    </Button>
                  </Tooltip>
                )}
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
