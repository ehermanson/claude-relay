/**
 * A collapsible project directory group in the sidebar — shows nav pills
 * (Overview, Plans, Issues, Skills, Chats) and session items.
 */

import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, EyeOff, MoreVertical, Plus } from "lucide-react";
import { SidebarItem } from "./sidebar-item";
import { Collapsible } from "../ui/collapsible";
import { Menu } from "../ui/menu";
import type { InstanceInfo } from "@shared/types";

const MAX_SIDEBAR_SESSIONS = 10;

interface SidebarProjectGroupProps {
  dir: string;
  groupInstances: InstanceInfo[];
  currentId?: string;
  currentProjectId?: string;
  locationPathname: string;
  isOpen: boolean;
  onToggle: (open: boolean) => void;
  sessionIdMap: Map<string, InstanceInfo>;
  hasBeads: boolean;
  onQuickCreate: (dir: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onMerge: (id: string) => void;
  onHide?: (dir: string) => void;
}

export function SidebarProjectGroup({
  dir,
  groupInstances,
  currentId,
  currentProjectId,
  locationPathname,
  isOpen,
  onToggle,
  sessionIdMap,
  hasBeads,
  onQuickCreate,
  onDelete,
  onRename,
  onMerge,
  onHide,
}: SidebarProjectGroupProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const dirName = dir.split("/").pop() || dir;
  const isActiveProject = currentProjectId === dirName;
  const isPlansActive = isActiveProject && locationPathname.includes("/plans");
  const isIssuesActive = isActiveProject && locationPathname.includes("/issues");
  const isSkillsActive = isActiveProject && locationPathname.includes("/skills");
  const isChatsActive = isActiveProject && locationPathname.includes("/chats") && !currentId;
  const isOverviewActive =
    isActiveProject &&
    !currentId &&
    !isPlansActive &&
    !isIssuesActive &&
    !isSkillsActive &&
    !isChatsActive;

  // Build parent/child ordered list: children appear right after their parent
  const childIds = new Set<string>();
  const parentChildren = new Map<string, InstanceInfo[]>();
  for (const inst of groupInstances) {
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

  const ordered: Array<{
    inst: InstanceInfo;
    isChild: boolean;
    parentInst?: InstanceInfo;
  }> = [];
  for (const inst of groupInstances) {
    if (childIds.has(inst.id)) continue;
    ordered.push({ inst, isChild: false });
    const children = parentChildren.get(inst.id);
    if (children) {
      for (const child of children) {
        ordered.push({ inst: child, isChild: true, parentInst: inst });
      }
    }
  }

  // Determine visible sessions: active + recent up to MAX
  let visible = ordered;
  let hiddenCount = 0;
  {
    const activeSessions = ordered.filter((o) => o.inst.status !== "stopped");
    const stoppedSessions = ordered.filter((o) => o.inst.status === "stopped");
    const slotsForStopped = Math.max(0, MAX_SIDEBAR_SESSIONS - activeSessions.length);
    const visibleIds = new Set([
      ...activeSessions.map((o) => o.inst.id),
      ...stoppedSessions.slice(0, slotsForStopped).map((o) => o.inst.id),
    ]);
    if (currentId) visibleIds.add(currentId);
    visible = ordered.filter((o) => visibleIds.has(o.inst.id));
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
        projectId: inst.workingDirectory.split("/").pop() || inst.workingDirectory,
        chatId: inst.id,
      }}
      onDelete={() => onDelete(inst.id)}
      deleteDisabled={inst.external === true && inst.status !== "stopped"}
      onRename={(name) => onRename(inst.id, name)}
      onMerge={inst.gitBranch && inst.hasChanges ? () => onMerge(inst.id) : undefined}
      activeChatId={currentId}
    />
  );

  return (
    <Collapsible.Root key={dir} open={isOpen} onOpenChange={onToggle}>
      <div className="group/project mb-0.5">
        {/* Project header -- collapse toggle + quick create as one row */}
        <div className="mx-2 flex items-center rounded-lg transition-colors hover:bg-surface-hover">
          <Collapsible.Trigger className="flex min-w-0 flex-1 items-center gap-1.5 py-2 pl-2 text-left">
            {isOpen ? (
              <ChevronDown size={12} strokeWidth={3} className="shrink-0 text-text-bright/60" />
            ) : (
              <ChevronRight size={12} strokeWidth={3} className="shrink-0 text-text-bright/60" />
            )}
            <span
              className={`min-w-0 flex-1 truncate text-[0.8125rem] font-semibold ${
                isActiveProject ? "text-accent" : "text-text-bright"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                navigate({
                  to: "/projects/$projectId",
                  params: { projectId: dirName },
                });
              }}
            >
              {dirName}
            </span>
          </Collapsible.Trigger>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onQuickCreate(dir);
              }}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium text-muted opacity-0 transition-all group-hover/project:opacity-100 hover:bg-accent/10 hover:text-accent"
            >
              <Plus size={12} strokeWidth={2.5} />
              New Chat
            </button>
            {onHide &&
              (menuOpen ? (
                <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
                  <Menu.Trigger
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded text-muted hover:text-text"
                  >
                    <MoreVertical size={12} />
                  </Menu.Trigger>
                  <Menu.Content>
                    <Menu.Item
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        onHide(dir);
                      }}
                    >
                      <EyeOff size={13} strokeWidth={2} className="text-muted" />
                      Hide project
                    </Menu.Item>
                  </Menu.Content>
                </Menu.Root>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(true);
                  }}
                  className="flex h-5 w-5 items-center justify-center rounded text-muted/60 opacity-0 transition-opacity duration-150 group-hover/project:opacity-100 hover:text-text"
                >
                  <MoreVertical size={12} />
                </button>
              ))}
          </div>
        </div>

        {/* Content */}
        <Collapsible.Content>
          {/* Section links — compact text row, only non-obvious destinations */}
          <div className="flex items-center gap-1.5 pb-1 pl-8 pr-4 text-[0.6875rem]">
            <NavLink
              to="/projects/$projectId/plans"
              params={{ projectId: dirName }}
              active={isPlansActive}
            >
              Plans
            </NavLink>
            {hasBeads && (
              <>
                <span className="text-border">·</span>
                <NavLink
                  to="/projects/$projectId/issues"
                  params={{ projectId: dirName }}
                  active={isIssuesActive}
                >
                  Issues
                </NavLink>
              </>
            )}
            <span className="text-border">·</span>
            <NavLink
              to="/projects/$projectId/skills"
              params={{ projectId: dirName }}
              active={isSkillsActive}
            >
              Skills
            </NavLink>
          </div>

          {/* Session items */}
          <div className="px-2">
            {visible.map(renderSessionItem)}

            {/* Show all link */}
            {hiddenCount > 0 && (
              <Link
                to="/projects/$projectId/chats"
                params={{ projectId: dirName }}
                className="flex w-full items-center gap-1 rounded-md py-1.5 pl-8 pr-3 text-left text-xs text-muted transition-colors hover:bg-surface-hover hover:text-accent"
              >
                +{hiddenCount} more
                <ChevronRight size={10} strokeWidth={2.5} />
              </Link>
            )}
          </div>
        </Collapsible.Content>
      </div>
    </Collapsible.Root>
  );
}

/** Lightweight text link used in the project group section row. */
function NavLink({
  to,
  params,
  active,
  children,
}: {
  to: string;
  params: Record<string, string>;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      params={params}
      className={`font-medium transition-colors ${
        active ? "text-accent" : "text-muted hover:text-text"
      }`}
    >
      {children}
    </Link>
  );
}
