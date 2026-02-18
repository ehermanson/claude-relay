import { useState, useRef, useEffect } from "react";
import { useNavigate, useParams, Link } from "@tanstack/react-router";
import { useWSMethods, useWSState } from "../../context/websocket-context";
import { useAuthContext } from "../../context/auth-context";
import { SidebarItem } from "./sidebar-item";
import { ThemeToggle } from "../ui/theme-toggle";
import { RelayLogo } from "../ui/relay-logo";
import { Button } from "../ui/button";
import { Popover } from "../ui/popover";
import { Collapsible } from "../ui/collapsible";
import { Tooltip } from "../ui/tooltip";

import { NewInstanceForm } from "../forms/new-instance-form";
import { fetchGitHubLinks } from "../../lib/api";
import type { InstanceInfo } from "@shared/types";

const MAX_SIDEBAR_SESSIONS = 10;

export function Sidebar() {
  const { send } = useWSMethods();
  const { isConnected, instances } = useWSState();
  const { logout } = useAuthContext();
  const navigate = useNavigate();
  const { chatId: currentId, projectId: currentProjectId } = useParams({ strict: false }) as {
    chatId?: string;
    projectId?: string;
  };
  const [showForm, setShowForm] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const prevInstanceIds = useRef(new Set<string>());
  const pendingCreate = useRef(false);

  // GitHub links
  const [githubLinks, setGithubLinks] = useState<Record<string, string>>({});
  useEffect(() => {
    fetchGitHubLinks()
      .then(setGithubLinks)
      .catch(() => {});
  }, []);

  const [searchQuery, setSearchQuery] = useState("");

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

  // Filter instances
  let filteredInstances = instances;
  if (searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    filteredInstances = filteredInstances.filter((i) => i.name.toLowerCase().includes(q));
  }

  const isSearching = searchQuery.trim().length > 0;

  // Group instances by working directory, split into git and non-git
  const groupMap = new Map<string, InstanceInfo[]>();
  for (const inst of filteredInstances) {
    const dir = inst.workingDirectory;
    if (!groupMap.has(dir)) groupMap.set(dir, []);
    groupMap.get(dir)!.push(inst);
  }
  // Sort instances within each group by most recent activity
  for (const group of groupMap.values()) {
    group.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }
  // Split into git and non-git
  const gitGroups: [string, InstanceInfo[]][] = [];
  const systemGroups: [string, InstanceInfo[]][] = [];
  for (const [dir, group] of groupMap.entries()) {
    if (group.some((i) => i.gitInfo)) {
      gitGroups.push([dir, group]);
    } else {
      systemGroups.push([dir, group]);
    }
  }
  // Sort each by most recent activity
  gitGroups.sort(([, a], [, b]) => b[0].lastActivityAt - a[0].lastActivityAt);
  systemGroups.sort(([, a], [, b]) => b[0].lastActivityAt - a[0].lastActivityAt);

  // Build a sessionId→instance lookup for parent linking
  const sessionIdMap = new Map<string, InstanceInfo>();
  for (const inst of instances) {
    if (inst.sessionId) sessionIdMap.set(inst.sessionId, inst);
  }

  const handleCreate = (options: {
    name?: string;
    workingDirectory?: string;
    dangerouslySkipPermissions?: boolean;
  }) => {
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
    const isOpen = isSearching || !collapsedDirs.has(dir);
    const gitInfo = groupInstances.find((i) => i.gitInfo)?.gitInfo;

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

    // Determine visible sessions: all when searching, otherwise active + recent up to MAX
    let visible = ordered;
    let hiddenCount = 0;
    if (!isSearching) {
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
        <div className="mb-1.5">
          {/* Project header — collapse toggle */}
          <div className="group flex items-center gap-1.5 px-3 pt-4 pb-1">
            <Collapsible.Trigger className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-0.5 text-left transition-colors hover:bg-surface-hover">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`shrink-0 text-text-bright/60 transition-transform ${isOpen ? "" : "-rotate-90"}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
              {gitInfo ? (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-text/40"
                  aria-label="Git repository"
                >
                  <line x1="6" y1="3" x2="6" y2="15" />
                  <circle cx="18" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 0 1-9 9" />
                </svg>
              ) : (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-text/40"
                  aria-label="Directory"
                >
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              )}
              <Tooltip content={dir} side="bottom">
                <span
                  className={`min-w-0 flex-1 truncate text-[0.875rem] font-semibold uppercase tracking-wider ${
                    isActiveProject ? "text-accent" : "text-text-bright"
                  }`}
                >
                  {dirName}
                </span>
              </Tooltip>
            </Collapsible.Trigger>
            {githubLinks[dir] && (
              <Tooltip content="Open on GitHub">
                <a
                  href={githubLinks[dir]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted/50 transition-colors hover:text-text"
                  onClick={(e) => e.stopPropagation()}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                </a>
              </Tooltip>
            )}
          </div>

          {/* Content */}
          <Collapsible.Content>
            <div className="pl-6 pr-2">
              {/* Overview link */}
              <Link
                to="/projects/$projectId"
                params={{ projectId: dirName }}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[0.8125rem] transition-colors ${
                  isActiveProject && !currentId
                    ? "bg-accent-dim text-accent"
                    : "text-muted hover:bg-surface-hover hover:text-text"
                }`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0"
                >
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                </svg>
                Overview
              </Link>

              {/* Sessions section */}
              <div className="mt-1.5 flex items-center gap-1.5 px-3 py-1">
                <span className="flex-1 text-[0.6875rem] font-medium uppercase tracking-wider text-muted/70">
                  Sessions
                </span>
                <Tooltip content={`New instance in ${dirName}`}>
                  <button
                    onClick={() => handleQuickCreate(dir)}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted/50 transition-colors hover:text-accent"
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </Tooltip>
              </div>

              {/* Session items */}
              {visible.map(renderSessionItem)}

              {/* Show all link */}
              {hiddenCount > 0 && (
                <Link
                  to="/projects/$projectId/chats"
                  params={{ projectId: dirName }}
                  className="flex w-full items-center gap-1 rounded-md px-3 py-1.5 text-left text-xs text-muted transition-colors hover:bg-surface-hover hover:text-accent"
                >
                  Show all ({ordered.length})
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Link>
              )}
            </div>
          </Collapsible.Content>
        </div>
      </Collapsible.Root>
    );
  };

  const hasResults = gitGroups.length > 0 || systemGroups.length > 0;

  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-surface">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-5 py-4">
        <Link
          to="/"
          className="flex items-center gap-2.5 rounded-md transition-opacity hover:opacity-80"
        >
          <RelayLogo size={44} connected={isConnected} />
          <span className="text-[0.9375rem] font-semibold tracking-tight text-text-bright">
            Claude Relay
          </span>
        </Link>
        <div className="flex items-center gap-1">
          <Popover.Root open={showForm} onOpenChange={setShowForm}>
            <Tooltip content="New instance">
              <Popover.Trigger className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </Popover.Trigger>
            </Tooltip>
            <Popover.Content className="w-72" align="end">
              <NewInstanceForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
            </Popover.Content>
          </Popover.Root>
          <ThemeToggle className="h-7 w-7" />
          <Tooltip content="Logout">
            <Button variant="icon" onClick={logout}>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Search */}
      {instances.length > 0 && (
        <div className="shrink-0 px-3 pb-2">
          <div className="relative">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="h-7 w-full rounded-md border border-border bg-bg pl-8 pr-2 text-xs text-text placeholder:text-muted/60 focus:border-accent focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Instance list */}
      <div className="flex-1 overflow-y-auto pb-2">
        {instances.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
            <p className="mb-1 text-sm text-muted">No instances running</p>
            <span className="text-xs text-muted opacity-60">Create one to get started</span>
          </div>
        ) : !hasResults ? (
          <div className="flex flex-col items-center justify-center p-10 text-center">
            <p className="mb-1 text-xs text-muted">No matching instances</p>
            <button
              onClick={() => setSearchQuery("")}
              className="text-xs text-accent hover:underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          <>
            {/* Git repositories */}
            {gitGroups.map(([dir, groupInstances]) => renderGroup(dir, groupInstances))}

            {/* Divider between git and system groups */}
            {gitGroups.length > 0 && systemGroups.length > 0 && (
              <div className="mt-3 mb-1 flex items-center gap-2 px-5">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted/60">
                  Other Directories
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}

            {/* Non-git directories */}
            {systemGroups.map(([dir, groupInstances]) => renderGroup(dir, groupInstances))}
          </>
        )}
      </div>
    </aside>
  );
}
