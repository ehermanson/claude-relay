/**
 * A collapsible project directory group in the sidebar header plus session items.
 */

import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  GitBranch,
  MessageSquarePlus,
  MoreVertical,
  Plus,
} from "lucide-react";
import type { InstanceInfo, Project, SpaceInfo } from "@shared/types";
import { getInstanceProjectRouteId, getProjectName } from "../../lib/project-route";
import { getChatRecencyTimestamp } from "@/lib/utils";
import { isAttachedReviewInstance } from "@/lib/review-session";
import { isSpaceOwnedInstance } from "../../lib/space-membership";
import { useSidebarActions } from "../../context/sidebar-actions-context";
import { EmptyProjectActions } from "../empty-project-actions";
import { Button } from "../ui/button";
import { Collapsible } from "../ui/collapsible";
import { Menu } from "../ui/menu";
import { Tooltip } from "../ui/tooltip";
import { ProjectActionsMenuContent } from "./project-actions-menu";
import { SidebarItem } from "./sidebar-item";
import { SidebarSpaceGroup } from "./sidebar-space-group";

const MAX_SIDEBAR_SESSIONS = 10;
// Stopped chats idle longer than this collapse into "+N more", except the
// newest few which stay as an anchor so the group never renders empty.
const STALE_SESSION_MS = 10 * 24 * 60 * 60 * 1000;
const MIN_VISIBLE_STOPPED = 2;

function ProjectInitialBadge({ initial }: { initial: string }) {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-surface-hover text-[0.6875rem] font-extrabold uppercase leading-none text-text-bright/80">
      {initial}
    </span>
  );
}

interface SidebarProjectGroupProps {
  dir: string;
  project?: Pick<Project, "id" | "name" | "directory" | "slug">;
  groupInstances: InstanceInfo[];
  currentId?: string;
  currentProjectId?: string;
  locationPathname: string;
  iconPath?: string;
  isOpen: boolean;
  onToggle: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  onMoveToTop?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onMoveToBottom?: () => void;
  spaces?: SpaceInfo[];
  latestChatIdBySpace?: Record<string, string>;
  activeSpaceId?: string;
  loading?: boolean;
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
  isFirst,
  isLast,
  onMoveToTop,
  onMoveUp,
  onMoveDown,
  onMoveToBottom,
  spaces,
  latestChatIdBySpace,
  activeSpaceId,
  loading,
}: SidebarProjectGroupProps) {
  const navigate = useNavigate();
  const actions = useSidebarActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [iconHovered, setIconHovered] = useState(false);
  const [imgError, setImgError] = useState(false);

  const dirName = getProjectName(dir);
  const initial = dirName.charAt(0).toUpperCase() || "?";
  const showFavicon = iconPath && !imgError;
  // Prefer the sticky human-readable slug; fall back to UUID (legacy URLs) or
  // to an instance's slug/UUID, finally to the directory basename.
  const routeProjectId =
    project?.slug ??
    project?.id ??
    groupInstances[0]?.projectSlug ??
    groupInstances[0]?.projectId ??
    dirName;
  const isActiveProject = currentProjectId === routeProjectId;
  const removeProjectTarget = {
    id: project?.id ?? groupInstances.find((instance) => instance.projectId)?.projectId,
    name: project?.name ?? dirName,
    directory: dir,
  };
  const mainInstances = groupInstances.filter(
    (instance) => !isSpaceOwnedInstance(instance, spaces) && !isAttachedReviewInstance(instance),
  );

  const childIds = new Set<string>();
  const parentChildren = new Map<string, InstanceInfo[]>();
  for (const inst of mainInstances) {
    if (inst.parentSessionId) {
      const parent = groupInstances.find(
        (i) => i.sessionId === inst.parentSessionId && i.workingDirectory === inst.workingDirectory,
      );
      if (parent) {
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
        const shouldShowChild = !child.review || currentId === inst.id || currentId === child.id;
        if (shouldShowChild) {
          ordered.push({ inst: child, isChild: true, parentInst: inst });
        }
      }
    }
  }

  let visible = ordered;
  let hiddenCount = 0;
  {
    const activeSessions = ordered.filter((entry) => entry.inst.status !== "stopped");
    const stoppedSessions = ordered.filter((entry) => entry.inst.status === "stopped");
    const slotsForStopped = Math.max(0, MAX_SIDEBAR_SESSIONS - activeSessions.length);
    // Stopped chats are already sorted newest-first; drop stale ones beyond
    // the anchor count before applying the slot cap.
    const now = Date.now();
    const recentStopped = stoppedSessions.filter(
      (entry, index) =>
        index < MIN_VISIBLE_STOPPED || now - getChatRecencyTimestamp(entry.inst) < STALE_SESSION_MS,
    );
    const visibleIds = new Set([
      ...activeSessions.map((entry) => entry.inst.id),
      ...recentStopped.slice(0, slotsForStopped).map((entry) => entry.inst.id),
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
      activeChatId={currentId}
    />
  );

  return (
    <Collapsible.Root key={dir} open={isOpen} onOpenChange={() => onToggle()}>
      <div className="group/project mb-0.5">
        <div className="mx-2 flex items-center rounded-lg transition-colors hover:bg-surface-hover">
          <Collapsible.Trigger
            className="flex min-w-0 flex-1 items-center gap-1.5 py-2.5 pl-2 text-left"
            onMouseEnter={() => setIconHovered(true)}
            onMouseLeave={() => setIconHovered(false)}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
              {showFavicon && !iconHovered ? (
                <img
                  src={`/api/file?path=${encodeURIComponent(iconPath)}`}
                  alt=""
                  className="h-5 w-5 rounded-sm object-contain"
                  onError={() => setImgError(true)}
                />
              ) : !showFavicon && !iconHovered ? (
                <ProjectInitialBadge initial={initial} />
              ) : isOpen ? (
                <ChevronDown size={14} strokeWidth={3} className="text-text-bright/60" />
              ) : (
                <ChevronRight size={14} strokeWidth={3} className="text-text-bright/60" />
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

          <div className="flex shrink-0 items-center gap-1">
            <Menu.Root open={newMenuOpen} onOpenChange={setNewMenuOpen}>
              <Tooltip content="New" side="top">
                <Menu.Trigger
                  onClick={(event: React.MouseEvent) => {
                    event.stopPropagation();
                  }}
                  className="sidebar-menu-trigger flex h-7 w-7 items-center justify-center rounded-md text-muted opacity-0 transition-all group-hover/project:opacity-100 hover:bg-surface-hover hover:text-text"
                >
                  <Plus size={15} strokeWidth={2.5} />
                </Menu.Trigger>
              </Tooltip>
              <Menu.Content align="start">
                <Menu.Item
                  className="!items-start"
                  onClick={(event: React.MouseEvent) => {
                    event.stopPropagation();
                    actions.quickCreate(dir);
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
                    actions.createSpace(dir);
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
                  className="flex h-7 w-7 items-center justify-center rounded text-muted hover:text-text"
                >
                  <MoreVertical size={16} />
                </Menu.Trigger>
                <ProjectActionsMenuContent
                  routeProjectId={routeProjectId}
                  removeProjectTarget={removeProjectTarget}
                  reorder={{
                    isFirst,
                    isLast,
                    onMoveToTop,
                    onMoveUp,
                    onMoveDown,
                    onMoveToBottom,
                  }}
                />
              </Menu.Root>
            ) : (
              <Button
                variant="icon"
                size="icon-sm"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen(true);
                }}
                className="sidebar-menu-trigger !h-7 !w-7 text-muted/60 opacity-0 transition-opacity duration-150 group-hover/project:opacity-100"
              >
                <MoreVertical size={16} />
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
                    chats={groupInstances.filter((inst) => inst.spaceId === space.id)}
                  />
                ))}

            {/* Chats */}
            {visible.map(renderSessionItem)}

            {hiddenCount > 0 && (
              <Link
                to="/projects/$projectId"
                params={{ projectId: routeProjectId }}
                className="flex w-full items-center gap-1 rounded-md py-1.5 pl-8 pr-3 text-left text-xs text-muted transition-colors hover:bg-surface-hover hover:text-accent"
              >
                +{hiddenCount} more
                <ChevronRight size={10} strokeWidth={2.5} />
              </Link>
            )}

            {visible.length === 0 &&
              (!spaces ||
                spaces.filter((s) => !s.isDefault && s.status === "active").length === 0) &&
              (loading ? (
                <div className="space-y-1.5 px-2 py-1">
                  <div className="h-7 w-full animate-pulse rounded-md bg-surface-hover/60" />
                  <div className="h-7 w-3/4 animate-pulse rounded-md bg-surface-hover/40" />
                </div>
              ) : (
                <div className="px-2 py-1">
                  <EmptyProjectActions
                    size="compact"
                    onNewChat={() => actions.quickCreate(dir)}
                    onNewSpace={() => actions.createSpace(dir)}
                  />
                </div>
              ))}
          </div>
        </Collapsible.Content>
      </div>
    </Collapsible.Root>
  );
}
