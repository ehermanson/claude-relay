import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useWS } from "../../context/WebSocketContext";
import { useAuthContext } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { SidebarItem } from "./SidebarItem";
import { NewInstanceForm } from "../forms/NewInstanceForm";
import type { InstanceInfo } from "@shared/types";

const INITIAL_SHOW_COUNT = 15;

export function Sidebar() {
  const { isConnected, instances, send } = useWS();
  const { logout } = useAuthContext();
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { id: currentId, projectId: currentProjectId } = useParams({ strict: false }) as {
    id?: string;
    projectId?: string;
  };
  const [showForm, setShowForm] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const prevInstanceIds = useRef(new Set<string>());
  const pendingCreate = useRef(false);

  // Navigate to newly created instance
  useEffect(() => {
    const currentIds = new Set(instances.map((i) => i.id));
    if (pendingCreate.current && prevInstanceIds.current.size > 0) {
      for (const inst of instances) {
        if (!prevInstanceIds.current.has(inst.id) && !inst.external) {
          pendingCreate.current = false;
          navigate({ to: "/chat/$id", params: { id: inst.id } });
          break;
        }
      }
    }
    prevInstanceIds.current = currentIds;
  }, [instances, navigate]);

  // Group instances by working directory
  const groups = useMemo(() => {
    const map = new Map<string, InstanceInfo[]>();
    for (const inst of instances) {
      const dir = inst.workingDirectory;
      if (!map.has(dir)) map.set(dir, []);
      map.get(dir)!.push(inst);
    }
    // Sort instances within each group by most recent activity
    for (const group of map.values()) {
      group.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    }
    // Sort groups by most recent activity across their instances
    return new Map(
      [...map.entries()].sort(([, a], [, b]) => b[0].lastActivityAt - a[0].lastActivityAt),
    );
  }, [instances]);

  const handleCreate = useCallback(
    (options: {
      name?: string;
      workingDirectory?: string;
      dangerouslySkipPermissions?: boolean;
    }) => {
      pendingCreate.current = true;
      send({ type: "create_instance", ...options });
      setShowForm(false);
    },
    [send],
  );

  const handleQuickCreate = useCallback(
    (workingDirectory: string) => {
      pendingCreate.current = true;
      send({ type: "create_instance", workingDirectory });
    },
    [send],
  );

  const handleDelete = useCallback(
    (instanceId: string) => {
      send({ type: "remove_instance", instanceId });
    },
    [send],
  );

  const handleRefreshTitle = useCallback(
    (instanceId: string) => {
      send({ type: "refresh_title", instanceId });
    },
    [send],
  );

  const handleRename = useCallback(
    (instanceId: string, name: string) => {
      send({ type: "rename_instance", instanceId, name });
    },
    [send],
  );

  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-surface">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="text-[0.9375rem] font-semibold tracking-tight text-text-bright">
            Claude Relay
          </span>
          {isConnected ? (
            <span
              title="Connected to relay"
              className="h-2 w-2 rounded-full bg-accent shadow-[0_0_6px_var(--color-accent-glow)] transition-all"
            />
          ) : (
            <span
              title="Disconnected from relay"
              className="rounded-full bg-error/15 px-1.5 py-0.5 text-[0.625rem] font-medium leading-none text-error"
            >
              Offline
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowForm(!showForm)}
            title="New instance"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
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
          </button>
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            {theme === "dark" ? (
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
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
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
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <button
            onClick={logout}
            title="Logout"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
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
          </button>
        </div>
      </div>

      {/* New instance form */}
      {showForm && <NewInstanceForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />}

      {/* Instance list */}
      <div className="flex-1 overflow-y-auto pb-2">
        {instances.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
            <p className="mb-1 text-sm text-muted">No instances running</p>
            <span className="text-xs text-muted opacity-60">Create one to get started</span>
          </div>
        ) : (
          Array.from(groups.entries()).map(([dir, groupInstances]) => {
            const dirName = dir.split("/").pop() || dir;
            const isActiveProject = currentProjectId === dirName;
            const isCollapsed = collapsedDirs.has(dir);
            const gitInfo = groupInstances.find((i) => i.gitInfo)?.gitInfo;
            return (
              <div key={dir} className="mb-1.5">
                {/* Project header */}
                <div className="group flex items-center gap-1 px-3 pt-4 pb-1">
                  <button
                    onClick={() =>
                      setCollapsedDirs((prev) => {
                        const next = new Set(prev);
                        if (next.has(dir)) next.delete(dir);
                        else next.add(dir);
                        return next;
                      })
                    }
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted transition-colors hover:text-text-bright"
                    title={isCollapsed ? "Expand" : "Collapse"}
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {gitInfo ? (
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0 text-muted/50"
                      aria-label="Git repository"
                    >
                      <line x1="6" y1="3" x2="6" y2="15" />
                      <circle cx="18" cy="6" r="3" />
                      <circle cx="6" cy="18" r="3" />
                      <path d="M18 9a9 9 0 0 1-9 9" />
                    </svg>
                  ) : (
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0 text-muted/50"
                      aria-label="Directory"
                    >
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  )}
                  <button
                    onClick={() =>
                      navigate({
                        to: "/projects/$projectId",
                        params: { projectId: dirName },
                      })
                    }
                    className={`group/project min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-left text-[0.6875rem] font-semibold uppercase tracking-wider transition-colors hover:bg-surface-hover hover:underline ${
                      isActiveProject ? "text-accent" : "text-muted hover:text-text-bright"
                    }`}
                    title={dir}
                  >
                    {dirName}
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mb-px ml-0.5 inline shrink-0 opacity-0 transition-opacity group-hover/project:opacity-60"
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleQuickCreate(dir)}
                    title={`New instance in ${dirName}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted/50 transition-colors hover:text-accent"
                  >
                    <svg
                      width="12"
                      height="12"
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
                </div>

                {/* Instance items */}
                {!isCollapsed &&
                  (() => {
                    const isExpanded = expandedDirs.has(dir);
                    const activeIndex = groupInstances.findIndex((i) => i.id === currentId);
                    const needsExpand = activeIndex >= INITIAL_SHOW_COUNT;
                    const shouldShowAll =
                      isExpanded || needsExpand || groupInstances.length <= INITIAL_SHOW_COUNT;
                    const visible = shouldShowAll
                      ? groupInstances
                      : groupInstances.slice(0, INITIAL_SHOW_COUNT);
                    const hiddenCount = groupInstances.length - visible.length;
                    return (
                      <div className="px-2 pl-6">
                        {visible.map((inst) => (
                          <SidebarItem
                            key={inst.id}
                            instance={inst}
                            isActive={inst.id === currentId}
                            onClick={() => navigate({ to: "/chat/$id", params: { id: inst.id } })}
                            onDelete={() => handleDelete(inst.id)}
                            deleteDisabled={inst.external === true && inst.status !== "stopped"}
                            onRename={(name) => handleRename(inst.id, name)}
                            onRefreshTitle={() => handleRefreshTitle(inst.id)}
                          />
                        ))}
                        {hiddenCount > 0 && (
                          <button
                            onClick={() =>
                              setExpandedDirs((prev) => {
                                const next = new Set(prev);
                                next.add(dir);
                                return next;
                              })
                            }
                            className="w-full rounded-md px-2 py-1.5 text-left text-xs text-muted transition-colors hover:bg-surface-hover hover:text-text"
                          >
                            Show all ({groupInstances.length})
                          </button>
                        )}
                      </div>
                    );
                  })()}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
