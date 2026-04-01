/**
 * A collapsible project directory group in the sidebar header plus session items.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Bug,
  ChevronDown,
  ChevronRight,
  FolderMinus,
  GitBranch,
  MessageSquarePlus,
  MoreVertical,
  NotebookPen,
  Plus,
  Settings,
  Toolbox,
  Archive,
} from "lucide-react";
import type { InstanceInfo, Project, SpaceInfo } from "@shared/types";
import {
  getInstanceProjectRouteId,
  getProjectName,
  type RemoveProjectTarget,
} from "../../lib/project-route";
import { isSpaceOwnedInstance } from "../../lib/space-membership";
import { EmptyProjectActions } from "../empty-project-actions";
import { Button } from "../ui/button";
import { Collapsible } from "../ui/collapsible";
import { Menu } from "../ui/menu";
import { Tooltip } from "../ui/tooltip";
import { SidebarItem } from "./sidebar-item";
import { SidebarSpaceGroup } from "./sidebar-space-group";

const MAX_SIDEBAR_SESSIONS = 10;

function ProjectInitialBadge({ initial }: { initial: string }) {
  return (
    <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-surface-hover text-[0.6875rem] font-extrabold uppercase leading-none text-text-bright/80">
      {initial}
    </span>
  );
}

interface SidebarProjectGroupProps {
  dir: string;
  project?: Pick<Project, "id" | "name" | "directory">;
  groupInstances: InstanceInfo[];
  currentId?: string;
  currentProjectId?: string;
  locationPathname: string;
  iconPath?: string;
  isOpen: boolean;
  onToggle: () => void;
  sessionIdMap: Map<string, InstanceInfo>;
  onQuickCreate: (dir: string) => void;
  onDelete: (instance: Pick<InstanceInfo, "id" | "name">) => void;
  onRename: (id: string, name: string) => void;
  onMerge: (id: string) => void;
  onRemoveProject?: (project: RemoveProjectTarget) => void;
  isFirst?: boolean;
  isLast?: boolean;
  onMoveToTop?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onMoveToBottom?: () => void;
  spaces?: SpaceInfo[];
  latestChatIdBySpace?: Record<string, string>;
  activeSpaceId?: string;
  onCreateSpace: (dir: string) => void;
  onRenameSpace?: (spaceId: string, name: string) => void;
  onCompleteSpace?: (spaceId: string) => void;
  onDeleteSpace?: (spaceId: string) => void;
}

export function SidebarProjectGroup({
  dir,
  project,
  groupInstances,
  currentId,
  currentProjectId,
  iconPath,
  isOpen,
  onToggle,
  sessionIdMap,
  onQuickCreate,
  onDelete,
  onRename,
  onMerge,
  onRemoveProject,
  isFirst,
  isLast,
  onMoveToTop,
  onMoveUp,
  onMoveDown,
  onMoveToBottom,
  spaces,
  latestChatIdBySpace,
  activeSpaceId,
  onCreateSpace,
  onRenameSpace,
  onCompleteSpace,
  onDeleteSpace,
}: SidebarProjectGroupProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [iconHovered, setIconHovered] = useState(false);
  const [imgError, setImgError] = useState(false);

  const dirName = getProjectName(dir);
  const initial = dirName.charAt(0).toUpperCase() || "?";
  const showFavicon = iconPath && !imgError;
  const routeProjectId = project?.id ?? groupInstances[0]?.projectId ?? dirName;
  const isActiveProject = currentProjectId === routeProjectId;
  const removeProjectTarget: RemoveProjectTarget = {
    id: project?.id ?? groupInstances.find((instance) => instance.projectId)?.projectId,
    name: project?.name ?? dirName,
    directory: dir,
  };
  const mainInstances = groupInstances.filter(
    (instance) => !isSpaceOwnedInstance(instance, spaces),
  );

  const childIds = new Set<string>();
  const parentChildren = new Map<string, InstanceInfo[]>();
  for (const inst of mainInstances) {
    if (inst.parentSessionId) {
      const parent = sessionIdMap.get(inst.parentSessionId);
      if (parent && parent.workingDirectory === inst.workingDirectory) {
        childIds.add(inst.id);
        const children = parentChildren.get(parent.id) || [];
        children.push(inst);
        parentChildren.set(parent.id, children);
      }
    }
  }

  const ordered: Array<{ inst: InstanceInfo; isChild: boolean; parentInst?: InstanceInfo }> = [];
  for (const inst of mainInstances) {
    if (childIds.has(inst.id)) continue;
    ordered.push({ inst, isChild: false });
    const children = parentChildren.get(inst.id);
    if (children) {
      for (const child of children) {
        ordered.push({ inst: child, isChild: true, parentInst: inst });
      }
    }
  }

  let visible = ordered;
  let hiddenCount = 0;
  {
    const activeSessions = ordered.filter((entry) => entry.inst.status !== "stopped");
    const stoppedSessions = ordered.filter((entry) => entry.inst.status === "stopped");
    const slotsForStopped = Math.max(0, MAX_SIDEBAR_SESSIONS - activeSessions.length);
    const visibleIds = new Set([
      ...activeSessions.map((entry) => entry.inst.id),
      ...stoppedSessions.slice(0, slotsForStopped).map((entry) => entry.inst.id),
    ]);
    if (currentId) visibleIds.add(currentId);
    visible = ordered.filter((entry) => visibleIds.has(entry.inst.id));
    hiddenCount = ordered.length - visible.length;
  }

  const renderSessionItem = ({
    inst,
    isChild,
    parentInst,
  }: {
    inst: InstanceInfo;
    isChild: boolean;
    parentInst?: InstanceInfo;
  }) => (
    <SidebarItem
      key={inst.id}
      instance={inst}
      isActive={inst.id === currentId}
      isChild={isChild}
      parentInstance={parentInst ? { id: parentInst.id, name: parentInst.name } : undefined}
      to="/projects/$projectId/chats/$chatId"
      params={{
        projectId: getInstanceProjectRouteId(inst),
        chatId: inst.id,
      }}
      onDelete={onDelete}
      deleteDisabled={inst.external === true && inst.status !== "stopped"}
      onRename={(name) => onRename(inst.id, name)}
      onMerge={inst.gitBranch && inst.hasChanges ? () => onMerge(inst.id) : undefined}
      activeChatId={currentId}
    />
  );

  return (
    <Collapsible.Root key={dir} open={isOpen} onOpenChange={() => onToggle()}>
      <div className="group/project mb-0.5">
        <div className="mx-2 flex items-center rounded-lg transition-colors hover:bg-surface-hover">
          <Collapsible.Trigger
            className="flex min-w-0 flex-1 items-center gap-1.5 py-2 pl-2 text-left"
            onMouseEnter={() => setIconHovered(true)}
            onMouseLeave={() => setIconHovered(false)}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {showFavicon && !iconHovered ? (
                <img
                  src={`/api/file?path=${encodeURIComponent(iconPath)}`}
                  alt=""
                  className="h-4 w-4 rounded-sm object-contain"
                  onError={() => setImgError(true)}
                />
              ) : !showFavicon && !iconHovered ? (
                <ProjectInitialBadge initial={initial} />
              ) : isOpen ? (
                <ChevronDown size={12} strokeWidth={3} className="text-text-bright/60" />
              ) : (
                <ChevronRight size={12} strokeWidth={3} className="text-text-bright/60" />
              )}
            </span>
            <span
              className={`min-w-0 flex-1 truncate text-[0.8125rem] font-semibold ${
                isActiveProject ? "text-accent" : "text-text-bright"
              }`}
              onClick={(event) => {
                event.stopPropagation();
                navigate({
                  to: "/projects/$projectId",
                  params: { projectId: routeProjectId },
                });
              }}
            >
              {dirName}
            </span>
          </Collapsible.Trigger>

          <div className="flex shrink-0 items-center gap-0.5">
            <Menu.Root open={newMenuOpen} onOpenChange={setNewMenuOpen}>
              <Tooltip content="New" side="top">
                <Menu.Trigger
                  onClick={(event: React.MouseEvent) => {
                    event.stopPropagation();
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted opacity-0 transition-all group-hover/project:opacity-100 hover:bg-surface-hover hover:text-text"
                >
                  <Plus size={13} strokeWidth={2.5} />
                </Menu.Trigger>
              </Tooltip>
              <Menu.Content align="start">
                <Menu.Item
                  className="!items-start"
                  onClick={(event: React.MouseEvent) => {
                    event.stopPropagation();
                    onQuickCreate(dir);
                  }}
                >
                  <MessageSquarePlus size={13} strokeWidth={2} className="mt-1 text-muted" />
                  <div>
                    <div>New Chat</div>
                    <div className="text-[0.6875rem] text-muted">
                      Work with an agent on this branch
                    </div>
                  </div>
                </Menu.Item>
                <Menu.Item
                  className="!items-start"
                  onClick={(event: React.MouseEvent) => {
                    event.stopPropagation();
                    onCreateSpace(dir);
                  }}
                >
                  <GitBranch size={13} strokeWidth={2} className="mt-1 text-muted" />
                  <div>
                    <div>New Space</div>
                    <div className="text-[0.6875rem] text-muted">
                      Start an isolated worktree and merge back later
                    </div>
                  </div>
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>

            {menuOpen ? (
              <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
                <Menu.Trigger
                  onClick={(event: React.MouseEvent) => {
                    event.stopPropagation();
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded text-muted hover:text-text"
                >
                  <MoreVertical size={12} />
                </Menu.Trigger>
                <Menu.Content>
                  <Menu.Item
                    onClick={(event: React.MouseEvent) => {
                      event.stopPropagation();
                      navigate({
                        to: "/projects/$projectId/plans",
                        params: { projectId: routeProjectId },
                      });
                    }}
                  >
                    <NotebookPen size={13} strokeWidth={2} className="text-muted" />
                    Plans
                  </Menu.Item>
                  <Menu.Item
                    onClick={(event: React.MouseEvent) => {
                      event.stopPropagation();
                      navigate({
                        to: "/projects/$projectId/tasks",
                        params: { projectId: routeProjectId },
                      });
                    }}
                  >
                    <Bug size={13} strokeWidth={2} className="text-muted" />
                    Tasks
                  </Menu.Item>
                  <Menu.Item
                    onClick={(event: React.MouseEvent) => {
                      event.stopPropagation();
                      navigate({
                        to: "/projects/$projectId/skills",
                        params: { projectId: routeProjectId },
                      });
                    }}
                  >
                    <Toolbox size={13} strokeWidth={2} className="text-muted" />
                    Skills
                  </Menu.Item>
                  <Menu.Item
                    onClick={(event: React.MouseEvent) => {
                      event.stopPropagation();
                      navigate({
                        to: "/projects/$projectId/settings",
                        params: { projectId: routeProjectId },
                      });
                    }}
                  >
                    <Settings size={13} strokeWidth={2} className="text-muted" />
                    Settings
                  </Menu.Item>
                  <Menu.Separator />
                  {onMoveToTop && (
                    <Menu.Item
                      disabled={isFirst}
                      onClick={(event: React.MouseEvent) => {
                        event.stopPropagation();
                        onMoveToTop();
                      }}
                    >
                      <ArrowUpToLine size={13} strokeWidth={2} className="text-muted" />
                      Move to top
                    </Menu.Item>
                  )}
                  {onMoveUp && (
                    <Menu.Item
                      disabled={isFirst}
                      onClick={(event: React.MouseEvent) => {
                        event.stopPropagation();
                        onMoveUp();
                      }}
                    >
                      <ArrowUp size={13} strokeWidth={2} className="text-muted" />
                      Move up
                    </Menu.Item>
                  )}
                  {onMoveDown && (
                    <Menu.Item
                      disabled={isLast}
                      onClick={(event: React.MouseEvent) => {
                        event.stopPropagation();
                        onMoveDown();
                      }}
                    >
                      <ArrowDown size={13} strokeWidth={2} className="text-muted" />
                      Move down
                    </Menu.Item>
                  )}
                  {onMoveToBottom && (
                    <Menu.Item
                      disabled={isLast}
                      onClick={(event: React.MouseEvent) => {
                        event.stopPropagation();
                        onMoveToBottom();
                      }}
                    >
                      <ArrowDownToLine size={13} strokeWidth={2} className="text-muted" />
                      Move to bottom
                    </Menu.Item>
                  )}
                  {onRemoveProject && <Menu.Separator />}
                  {onRemoveProject && (
                    <Menu.Item
                      onClick={() => {
                        onRemoveProject(removeProjectTarget);
                      }}
                    >
                      <FolderMinus size={13} strokeWidth={2} className="text-muted" />
                      Remove project
                    </Menu.Item>
                  )}
                </Menu.Content>
              </Menu.Root>
            ) : (
              <Button
                variant="icon"
                size="icon-sm"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen(true);
                }}
                className="!h-5 !w-5 text-muted/60 opacity-0 transition-opacity duration-150 group-hover/project:opacity-100"
              >
                <MoreVertical size={12} />
              </Button>
            )}
          </div>
        </div>

        <Collapsible.Content>
          <div className="px-2">
            {/* Active spaces */}
            {spaces &&
              spaces.filter((s) => !s.isDefault && s.status === "active").length > 0 &&
              spaces
                .filter((s) => !s.isDefault && s.status === "active")
                .map((space) => (
                  <SidebarSpaceGroup
                    key={space.id}
                    space={space}
                    projectId={routeProjectId}
                    latestChatId={latestChatIdBySpace?.[space.id]}
                    isActive={activeSpaceId === space.id}
                    onRename={onRenameSpace ?? (() => {})}
                    onComplete={onCompleteSpace ?? (() => {})}
                    onDelete={onDeleteSpace ?? (() => {})}
                  />
                ))}

            {/* Chats */}
            {visible.map(renderSessionItem)}

            {hiddenCount > 0 && (
              <Link
                to="/projects/$projectId/chats"
                params={{ projectId: routeProjectId }}
                className="flex w-full items-center gap-1 rounded-md py-1.5 pl-8 pr-3 text-left text-xs text-muted transition-colors hover:bg-surface-hover hover:text-accent"
              >
                +{hiddenCount} more
                <ChevronRight size={10} strokeWidth={2.5} />
              </Link>
            )}

            {/* Closed spaces */}
            <SidebarClosedSpaces
              spaces={spaces}
              projectId={routeProjectId}
              latestChatIdBySpace={latestChatIdBySpace}
              activeSpaceId={activeSpaceId}
              onRenameSpace={onRenameSpace}
              onCompleteSpace={onCompleteSpace}
              onDeleteSpace={onDeleteSpace}
            />

            {visible.length === 0 &&
              (!spaces ||
                spaces.filter((s) => !s.isDefault && s.status === "active").length === 0) &&
              onCreateSpace && (
                <div className="px-2 py-1">
                  <EmptyProjectActions
                    size="compact"
                    onNewChat={() => onQuickCreate(dir)}
                    onNewSpace={() => onCreateSpace(dir)}
                  />
                </div>
              )}
          </div>
        </Collapsible.Content>
      </div>
    </Collapsible.Root>
  );
}

function SidebarClosedSpaces({
  spaces,
  projectId,
  latestChatIdBySpace,
  activeSpaceId,
  onRenameSpace,
  onCompleteSpace,
  onDeleteSpace,
}: {
  spaces?: SpaceInfo[];
  projectId: string;
  latestChatIdBySpace?: Record<string, string>;
  activeSpaceId?: string;
  onRenameSpace?: (spaceId: string, name: string) => void;
  onCompleteSpace?: (spaceId: string) => void;
  onDeleteSpace?: (spaceId: string) => void;
}) {
  const closedSpaces = spaces?.filter(
    (s) => !s.isDefault && (s.status === "completed" || s.status === "archived"),
  );
  // Auto-expand when the active space is in the closed list
  const hasActiveChild = closedSpaces?.some((s) => s.id === activeSpaceId) ?? false;
  const [open, setOpen] = useState(hasActiveChild);
  // If the active space changes to a closed space, expand
  useEffect(() => {
    if (hasActiveChild) setOpen(true);
  }, [hasActiveChild]);
  if (!closedSpaces || closedSpaces.length === 0) return null;

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 rounded-md py-1 pl-3 pr-2 text-left text-[0.6875rem] font-medium uppercase tracking-wide text-muted transition-colors hover:text-text"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <Archive size={10} className="text-muted" />
        Closed ({closedSpaces.length})
      </button>
      {open &&
        closedSpaces.map((space) => (
          <SidebarSpaceGroup
            key={space.id}
            space={space}
            projectId={projectId}
            latestChatId={latestChatIdBySpace?.[space.id]}
            isActive={activeSpaceId === space.id}
            onRename={onRenameSpace ?? (() => {})}
            onComplete={onCompleteSpace ?? (() => {})}
            onDelete={onDeleteSpace ?? (() => {})}
          />
        ))}
    </div>
  );
}
