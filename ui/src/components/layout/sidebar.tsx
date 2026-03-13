import { useState, useRef, useEffect } from "react";
import { useNavigate, useParams, useLocation, Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Loader2, LogOut, Moon, Plus, Sun } from "lucide-react";
import { useWSMethods, useWSState } from "../../context/websocket-context";
import { useAuthContext } from "../../context/auth-context";
import { SidebarItem } from "./sidebar-item";
import { useTheme } from "../../context/theme-context";
import { RelayLogo } from "../ui/relay-logo";
import { Popover } from "../ui/popover";
import { Collapsible } from "../ui/collapsible";

import { NewInstanceForm } from "../forms/new-instance-form";
import { fetchBeadsProjects } from "../../lib/api";
import type { InstanceInfo } from "@shared/types";

const MAX_SIDEBAR_SESSIONS = 10;

export function Sidebar() {
  const { send } = useWSMethods();
  const { isConnected, isSyncing, instances } = useWSState();
  const { logout } = useAuthContext();
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { chatId: currentId, projectId: currentProjectId } = useParams({
    strict: false,
  }) as {
    chatId?: string;
    projectId?: string;
  };
  const location = useLocation();
  const [showForm, setShowForm] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const prevInstanceIds = useRef(new Set<string>());
  const pendingCreate = useRef(false);

  // Beads directories
  const [beadsDirs, setBeadsDirs] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetchBeadsProjects()
      .then((dirs) => setBeadsDirs(new Set(dirs)))
      .catch(() => {});
  }, []);

  // Navigate to newly created instance
  useEffect(() => {
    const currentIds = new Set(instances.map((i) => i.id));
    if (pendingCreate.current && prevInstanceIds.current.size > 0) {
      for (const inst of instances) {
        if (!prevInstanceIds.current.has(inst.id) && !inst.external) {
          pendingCreate.current = false;
          const projectId = inst.workingDirectory.split("/").pop() || inst.workingDirectory;
          navigate({
            to: "/projects/$projectId/chats/$chatId",
            params: { projectId, chatId: inst.id },
          });
          break;
        }
      }
    }
    prevInstanceIds.current = currentIds;
  }, [instances, navigate]);

  // Group instances by working directory, sorted by most recent activity
  const groupMap = new Map<string, InstanceInfo[]>();
  for (const inst of instances) {
    const dir = inst.workingDirectory;
    if (!groupMap.has(dir)) groupMap.set(dir, []);
    groupMap.get(dir)!.push(inst);
  }
  for (const group of groupMap.values()) {
    group.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }
  const groups = [...groupMap.entries()].sort(
    ([, a], [, b]) => b[0].lastActivityAt - a[0].lastActivityAt,
  );

  // Build a sessionId→instance lookup for parent linking
  const sessionIdMap = new Map<string, InstanceInfo>();
  for (const inst of instances) {
    if (inst.sessionId) sessionIdMap.set(inst.sessionId, inst);
  }

  const handleCreate = (options: { workingDirectory?: string }) => {
    pendingCreate.current = true;
    send({ type: "create_instance", ...options });
    setShowForm(false);
  };

  const handleQuickCreate = (workingDirectory: string) => {
    pendingCreate.current = true;
    send({ type: "create_instance", workingDirectory });
  };

  const handleDelete = (instanceId: string) => {
    send({ type: "remove_instance", instanceId });
  };

  const handleRefreshTitle = (instanceId: string) => {
    send({ type: "refresh_title", instanceId });
  };

  const handleRename = (instanceId: string, name: string) => {
    send({ type: "rename_instance", instanceId, name });
  };

  const handleMerge = (instanceId: string) => {
    send({ type: "merge_instance", instanceId });
  };

  const renderGroup = (dir: string, groupInstances: InstanceInfo[]) => {
    const dirName = dir.split("/").pop() || dir;
    const isActiveProject = currentProjectId === dirName;
    const isPlansActive = isActiveProject && location.pathname.includes("/plans");
    const isIssuesActive = isActiveProject && location.pathname.includes("/issues");
    const isChatsActive = isActiveProject && location.pathname.includes("/chats") && !currentId;
    const isOverviewActive =
      isActiveProject && !currentId && !isPlansActive && !isIssuesActive && !isChatsActive;
    const isOpen = !collapsedDirs.has(dir);
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
        onDelete={() => handleDelete(inst.id)}
        deleteDisabled={inst.external === true && inst.status !== "stopped"}
        onRename={(name) => handleRename(inst.id, name)}
        onRefreshTitle={() => handleRefreshTitle(inst.id)}
        onMerge={inst.gitBranch && inst.hasChanges ? () => handleMerge(inst.id) : undefined}
      />
    );

    return (
      <Collapsible.Root
        key={dir}
        open={isOpen}
        onOpenChange={(open) => {
          setCollapsedDirs((prev) => {
            const next = new Set(prev);
            if (open) next.delete(dir);
            else next.add(dir);
            return next;
          });
        }}
      >
        <div className="group/project mb-0.5">
          {/* Project header — collapse toggle + quick create as one row */}
          <div className="flex items-center rounded-lg mx-2 transition-colors hover:bg-surface-hover">
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
              >
                {dirName}
              </span>
            </Collapsible.Trigger>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleQuickCreate(dir);
              }}
              className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium text-muted opacity-0 transition-all group-hover/project:opacity-100 hover:bg-accent/10 hover:text-accent"
            >
              <Plus size={12} strokeWidth={2.5} />
              New Session
            </button>
          </div>

          {/* Content */}
          <Collapsible.Content>
            {/* Compact nav pills */}
            <div className="flex flex-wrap items-center gap-1 pl-8 pr-4 pb-1.5">
              <Link
                to="/projects/$projectId"
                params={{ projectId: dirName }}
                className={`rounded-md px-2 py-0.5 text-[0.6875rem] font-medium transition-colors ${
                  isOverviewActive
                    ? "bg-accent-dim text-accent"
                    : "text-muted hover:bg-surface-hover hover:text-text"
                }`}
              >
                Overview
              </Link>
              <Link
                to="/projects/$projectId/plans"
                params={{ projectId: dirName }}
                className={`rounded-md px-2 py-0.5 text-[0.6875rem] font-medium transition-colors ${
                  isPlansActive
                    ? "bg-accent-dim text-accent"
                    : "text-muted hover:bg-surface-hover hover:text-text"
                }`}
              >
                Plans
              </Link>
              {beadsDirs.has(dir) && (
                <Link
                  to="/projects/$projectId/issues"
                  params={{ projectId: dirName }}
                  className={`rounded-md px-2 py-0.5 text-[0.6875rem] font-medium transition-colors ${
                    isIssuesActive
                      ? "bg-accent-dim text-accent"
                      : "text-muted hover:bg-surface-hover hover:text-text"
                  }`}
                >
                  Issues
                </Link>
              )}
              <Link
                to="/projects/$projectId/chats"
                params={{ projectId: dirName }}
                className={`rounded-md px-2 py-0.5 text-[0.6875rem] font-medium transition-colors ${
                  isChatsActive
                    ? "bg-accent-dim text-accent"
                    : "text-muted hover:bg-surface-hover hover:text-text"
                }`}
              >
                Sessions
              </Link>
            </div>

            {/* Session items */}
            <div className="px-2">
              {visible.map(renderSessionItem)}

              {/* Show all link */}
              {hiddenCount > 0 && (
                <Link
                  to="/projects/$projectId/chats"
                  params={{ projectId: dirName }}
                  className="flex w-full items-center gap-1 rounded-md px-3 py-1.5 text-left text-xs text-muted transition-colors hover:bg-surface-hover hover:text-accent"
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
  };

  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-surface">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md transition-opacity hover:opacity-80"
        >
          <RelayLogo size={28} connected={isConnected} />
          <span
            className="text-[1.1rem] text-text-bright"
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontWeight: 900,
              letterSpacing: "0.04em",
            }}
          >
            Relay
          </span>
        </Link>
        <Popover.Root open={showForm} onOpenChange={setShowForm}>
          <Popover.Trigger className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text">
            <Plus size={14} strokeWidth={2.5} />
            New Project
          </Popover.Trigger>
          <Popover.Content className="w-72" align="end">
            <NewInstanceForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
          </Popover.Content>
        </Popover.Root>
      </div>

      {/* Instance list */}
      <div className="flex-1 overflow-y-auto pb-2">
        {instances.length === 0 && isSyncing ? (
          <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
            <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin text-muted" />
            <p className="text-sm text-muted">Syncing sessions...</p>
          </div>
        ) : instances.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
            <p className="mb-1 text-sm text-muted">No instances running</p>
            <span className="text-xs text-muted opacity-60">Create one to get started</span>
          </div>
        ) : (
          <>
            {groups.map(([dir, groupInstances]) => renderGroup(dir, groupInstances))}

            {/* Subtle syncing indicator when instances already loaded but scan in progress */}
            {isSyncing && (
              <div className="flex items-center justify-center gap-1.5 py-3 text-muted/60">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="text-[0.6875rem]">Syncing...</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2">
        <button
          onClick={toggleTheme}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.75rem] text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          {theme === "dark" ? "Light" : "Dark"}
        </button>
        <button
          onClick={logout}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.75rem] text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          <LogOut size={13} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
