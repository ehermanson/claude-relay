import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import {
  DownloadCloud,
  FolderPlus,
  Loader2,
  LogOut,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { toast } from "sonner";
import { useAuthContext } from "../../context/auth-context";
import { useWSState } from "../../context/websocket-context";
import { SidebarActionsProvider } from "../../context/sidebar-actions-context";
import { useSidebarNavigationController } from "@/hooks/use-sidebar-navigation-controller";
import {
  addProject as apiAddProject,
  createProject as apiCreateProject,
  fetchHealth,
} from "../../lib/api";
import { useSystemUpdate } from "@/hooks/use-system-update";
import { AddProjectForm } from "../forms/add-project-form";
import { CreateProjectForm } from "../forms/create-project-form";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover } from "../ui/popover";
import { RelayLogo } from "../ui/relay-logo";
import { Tabs } from "../ui/tabs";
import { Tooltip } from "../ui/tooltip";
import { SidebarProjectGroup } from "./sidebar-project-group";
import "./sidebar.css";

export function Sidebar({
  onCollapse,
  onSearchOpen,
  showLogo = false,
}: { onCollapse?: () => void; onSearchOpen?: () => void; showLogo?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { isConnected, isSyncing } = useWSState();
  const { isAuthenticated, logout } = useAuthContext();
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    staleTime: Infinity,
  });
  const {
    snapshot: updateSnapshot,
    isInstalling: isUpdateInstalling,
    isBusy: isUpdateBusy,
    stageLabel: updateStageLabel,
    install: installUpdateAction,
  } = useSystemUpdate();
  const showUpdateButton = Boolean(
    (updateSnapshot?.enabled && updateSnapshot.updateAvailable) || isUpdateInstalling,
  );

  useEffect(() => {
    if (health?.git?.isWorktree && health.git.spaceName) {
      document.title = health.git.spaceName;
    } else {
      const tags: string[] = [];
      if (import.meta.env.DEV) tags.push("Dev");
      if (health?.git?.isWorktree) tags.push(health.git.branch ?? "Worktree");
      document.title = tags.length > 0 ? `Relay (${tags.join(", ")})` : "Relay";
    }
  }, [health?.git?.isWorktree, health?.git?.branch, health?.git?.spaceName]);
  const {
    latestChatIdBySpace,
    moveDown,
    moveToBottom,
    moveToTop,
    moveUp,
    projectByDir,
    projects,
    registeredDirs,
    collapsed: collapsedDirs,
    toggleCollapsed: toggleDir,
    currentChatId,
    currentProjectId,
    currentSpaceId,
    projectEntries,
    createNewChat,
  } = useSidebarNavigationController();
  const location = useLocation();
  const currentId = currentChatId;

  const [showAddProject, setShowAddProject] = useState(false);
  const [projectTab, setProjectTab] = useState<"add" | "create">("add");
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleAddProject = async (directory: string) => {
    setAddProjectError(null);
    try {
      const project = await apiAddProject(directory);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setShowAddProject(false);
      toast.success(`Added "${project.name}"`);
    } catch (err) {
      setAddProjectError(err instanceof Error ? err.message : "Failed to add project");
    }
  };

  const handleCreateProject = async (parentDirectory: string, name: string) => {
    setCreateProjectError(null);
    setIsCreating(true);
    try {
      const project = await apiCreateProject(parentDirectory, name);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      setShowAddProject(false);
      toast.success(`Created "${project.name}"`);
    } catch (err) {
      setCreateProjectError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setIsCreating(false);
    }
  };

  const hasProjects = projects.length > 0;

  return (
    <SidebarActionsProvider
      currentProjectId={currentProjectId}
      currentSpaceId={currentSpaceId}
      projectByDir={projectByDir}
      createNewChat={createNewChat}
    >
      <aside
        className="flex h-full w-full flex-col bg-surface rounded-xl"
        style={{ containerName: "sidebar", containerType: "inline-size" }}
      >
        <div className="sidebar-header group/header flex shrink-0 items-center justify-between px-4 py-3">
          <Link
            to="/"
            className="flex items-center gap-2 rounded-md transition-opacity hover:opacity-80"
          >
            {showLogo ? (
              <RelayLogo size={28} className="sidebar-logo-icon" connected={isConnected} />
            ) : (
              <div className="h-7 w-7" aria-hidden />
            )}
            <span
              className="sidebar-logo-text text-[1.1rem] text-text-bright"
              style={{
                fontFamily: "'Orbitron', sans-serif",
                fontWeight: 900,
                letterSpacing: "0.04em",
              }}
            >
              Relay
            </span>
            {(import.meta.env.DEV || health?.git?.isWorktree) && (
              <span className="sidebar-logo-text flex items-center gap-1">
                {import.meta.env.DEV && (
                  <Badge variant="default" size="xs">
                    Dev
                  </Badge>
                )}
                {health?.git?.isWorktree && (
                  <Badge variant="accent" size="xs">
                    Worktree
                  </Badge>
                )}
              </span>
            )}
          </Link>
          <div className="flex items-center gap-1">
            {onCollapse && (
              <Tooltip content="Collapse sidebar" side="bottom">
                <Button
                  variant="icon"
                  onClick={onCollapse}
                  className="opacity-0 transition-opacity duration-200 ease-in group-hover/header:opacity-100"
                >
                  <PanelLeftClose size={15} strokeWidth={2} />
                </Button>
              </Tooltip>
            )}
            <Popover.Root
              open={showAddProject}
              onOpenChange={(open) => {
                setShowAddProject(open);
                if (!open) {
                  setAddProjectError(null);
                  setCreateProjectError(null);
                  setProjectTab("add");
                }
              }}
            >
              <Tooltip content="Add project" side="bottom">
                <Popover.Trigger render={<Button variant="icon" />}>
                  <Plus size={14} strokeWidth={2.5} />
                </Popover.Trigger>
              </Tooltip>
              <Popover.Content className="w-96 max-w-[calc(100vw-2rem)]" align="end">
                <Tabs.Root
                  value={projectTab}
                  onValueChange={(v) => setProjectTab(v as "add" | "create")}
                >
                  <Tabs.List className="mb-3">
                    <Tabs.Tab value="add" className="flex-1 text-center">
                      Add Existing
                    </Tabs.Tab>
                    <Tabs.Tab value="create" className="flex-1 text-center">
                      Create New
                    </Tabs.Tab>
                  </Tabs.List>
                  <Tabs.Panel value="add">
                    <AddProjectForm
                      onSubmit={handleAddProject}
                      onCancel={() => setShowAddProject(false)}
                      error={addProjectError}
                      registeredDirs={registeredDirs}
                    />
                  </Tabs.Panel>
                  <Tabs.Panel value="create">
                    <CreateProjectForm
                      onSubmit={handleCreateProject}
                      onCancel={() => setShowAddProject(false)}
                      error={createProjectError}
                      isSubmitting={isCreating}
                    />
                  </Tabs.Panel>
                </Tabs.Root>
              </Popover.Content>
            </Popover.Root>
          </div>
        </div>

        {/* Search trigger */}
        <div className="shrink-0 px-3 pb-2">
          <button
            type="button"
            onClick={() => onSearchOpen?.()}
            className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[0.8125rem] text-muted transition-colors hover:bg-bg-2 hover:text-text"
          >
            <Search size={14} className="shrink-0" />
            <span className="flex-1 text-left">Search</span>
            <kbd className="hidden rounded border border-border/70 px-1 py-0.5 font-mono text-[0.5625rem] text-muted/60 opacity-0 transition-opacity group-hover:opacity-100 @[10rem]:inline">
              ⌘K
            </kbd>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pb-2">
          {!hasProjects && isSyncing ? (
            <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
              <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin text-muted" />
              <p className="text-sm text-muted">Syncing...</p>
            </div>
          ) : !hasProjects ? (
            <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
              <FolderPlus className="mx-auto mb-3 h-8 w-8 text-muted/40" />
              <p className="mb-1 text-sm text-muted">No projects registered</p>
              <span className="text-xs text-muted opacity-60">Add a git repo to get started</span>
            </div>
          ) : (
            <>
              {projectEntries.map((entry, index) => (
                <SidebarProjectGroup
                  key={entry.dir}
                  dir={entry.dir}
                  project={entry.project}
                  groupInstances={entry.groupInstances}
                  currentId={currentId}
                  currentProjectId={currentProjectId}
                  locationPathname={location.pathname}
                  iconPath={entry.iconPath}
                  isOpen={!collapsedDirs.has(entry.dir)}
                  onToggle={() => toggleDir(entry.dir)}
                  isFirst={index === 0}
                  isLast={index === projectEntries.length - 1}
                  onMoveToTop={() => moveToTop(entry.dir)}
                  onMoveUp={() => moveUp(entry.dir)}
                  onMoveDown={() => moveDown(entry.dir)}
                  onMoveToBottom={() => moveToBottom(entry.dir)}
                  spaces={entry.spaces}
                  latestChatIdBySpace={latestChatIdBySpace}
                  activeSpaceId={currentSpaceId}
                  loading={entry.loading}
                />
              ))}

              {isSyncing && (
                <div className="flex items-center justify-center gap-1.5 py-3 text-muted/60">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="text-[0.6875rem]">Syncing...</span>
                </div>
              )}
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-border">
          <div className="sidebar-footer flex items-center justify-between gap-1 px-2 py-2">
            <div className="flex items-center gap-0.5">
              <Link to="/settings">
                <Button variant="ghost" size="sm">
                  <Settings size={14} />
                  Settings
                </Button>
              </Link>
            </div>
            <div className="flex items-center gap-1">
              {showUpdateButton && (
                <Tooltip
                  content={
                    isUpdateInstalling
                      ? (updateStageLabel ?? "Installing update…")
                      : "Install update and restart Relay"
                  }
                  side="top"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isUpdateBusy}
                    onClick={() => installUpdateAction()}
                    className="relative !text-amber-400 hover:!bg-amber-500/10 hover:!text-amber-300 disabled:!opacity-100"
                    aria-label={
                      isUpdateInstalling
                        ? (updateStageLabel ?? "Installing update…")
                        : "Install update and restart Relay"
                    }
                  >
                    {isUpdateInstalling ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        <span className="max-w-[120px] truncate">
                          {updateStageLabel ?? "Updating…"}
                        </span>
                      </>
                    ) : (
                      <>
                        <DownloadCloud size={13} />
                        Update
                        <span className="absolute right-1 top-1 h-1.5 w-1.5 animate-pulse-dot rounded-full bg-amber-400" />
                      </>
                    )}
                  </Button>
                </Tooltip>
              )}
              {isAuthenticated && (
                <Button variant="ghost" size="sm" onClick={logout}>
                  <LogOut size={13} />
                  Sign out
                </Button>
              )}
            </div>
          </div>
        </div>
      </aside>
    </SidebarActionsProvider>
  );
}
