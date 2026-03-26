import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { FolderPlus, Loader2, LogOut, PanelLeftClose, Plus, Settings } from "lucide-react";
import { toast } from "sonner";
import type { InstanceInfo } from "@shared/types";
import { useAuthContext } from "../../context/auth-context";
import { useWSMethods, useWSState } from "../../context/websocket-context";
import { useActionToasts } from "../../hooks/use-action-toasts";
import { useProjectNavigationModel } from "../../hooks/use-project-navigation-model";
import {
  addProject as apiAddProject,
  createProject as apiCreateProject,
  completeSpace,
  deleteSpace,
  fetchHealth,
  fetchProjectIcons,
  removeProject as apiRemoveProject,
} from "../../lib/api";
import { getInstanceProjectRouteId, type RemoveProjectTarget } from "../../lib/project-route";
import { AddProjectForm } from "../forms/add-project-form";
import { CreateProjectForm } from "../forms/create-project-form";
import { ConfirmMergeDialog } from "../spaces/confirm-merge-dialog";
import { CreateSpaceDialog, useCreateSpaceDialog } from "../spaces/create-space-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ConfirmActionDialog } from "../ui/confirm-action-dialog";
import { Popover } from "../ui/popover";
import { RelayLogo } from "../ui/relay-logo";
import { Tabs } from "../ui/tabs";
import { Tooltip } from "../ui/tooltip";
import { SidebarProjectGroup } from "./sidebar-project-group";
import "./sidebar.css";

export function Sidebar({
  onCollapse,
  showLogo = false,
}: { onCollapse?: () => void; showLogo?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { send } = useWSMethods();
  const { isConnected, isSyncing, instances } = useWSState();
  const { trackInstanceCreate, trackInstanceMerge, trackInstanceRemove } = useActionToasts();
  const { isAuthenticated, logout } = useAuthContext();
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    staleTime: Infinity,
  });
  const {
    groups,
    moveDown,
    moveToBottom,
    moveToTop,
    moveUp,
    projectByDir,
    projectSpaces,
    projects,
    registeredDirs,
    collapsed: collapsedDirs,
    toggleCollapsed: toggleDir,
  } = useProjectNavigationModel();
  const navigate = useNavigate();
  const location = useLocation();
  const {
    chatId: currentId,
    projectId: currentProjectId,
    spaceId: currentSpaceId,
  } = useParams({ strict: false }) as {
    chatId?: string;
    projectId?: string;
    spaceId?: string;
  };

  const [showAddProject, setShowAddProject] = useState(false);
  const [projectTab, setProjectTab] = useState<"add" | "create">("add");
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [confirmRemoveInstance, setConfirmRemoveInstance] = useState<Pick<
    InstanceInfo,
    "id" | "name"
  > | null>(null);
  const [confirmRemoveProject, setConfirmRemoveProject] = useState<RemoveProjectTarget | null>(
    null,
  );
  const spaceDialog = useCreateSpaceDialog();
  const [confirmCompleteSpaceId, setConfirmCompleteSpaceId] = useState<string | null>(null);

  const prevInstanceIds = useRef(new Set<string>());
  const pendingCreate = useRef(false);

  const { data: projectIcons = {} } = useQuery({
    queryKey: ["projectIcons"],
    queryFn: fetchProjectIcons,
  });

  useEffect(() => {
    const currentIds = new Set(instances.map((instance) => instance.id));
    if (pendingCreate.current && prevInstanceIds.current.size > 0) {
      for (const instance of instances) {
        if (!prevInstanceIds.current.has(instance.id) && !instance.external) {
          pendingCreate.current = false;
          navigate({
            to: "/projects/$projectId/chats/$chatId",
            params: { projectId: getInstanceProjectRouteId(instance), chatId: instance.id },
          });
          break;
        }
      }
    }
    prevInstanceIds.current = currentIds;
  }, [instances, navigate]);

  const sessionIdMap = new Map<string, InstanceInfo>();
  for (const instance of instances) {
    if (instance.sessionId) sessionIdMap.set(instance.sessionId, instance);
  }

  const handleQuickCreate = (workingDirectory: string) => {
    pendingCreate.current = true;
    trackInstanceCreate(workingDirectory);
    send({ type: "create_instance", workingDirectory });
  };

  const handleDelete = (instance: Pick<InstanceInfo, "id" | "name">) => {
    setConfirmRemoveInstance(instance);
  };

  const handleRename = (instanceId: string, name: string) => {
    send({ type: "rename_instance", instanceId, name });
  };

  const handleMerge = (instanceId: string) => {
    const instance = instances.find((entry) => entry.id === instanceId);
    if (instance) trackInstanceMerge(instance);
    send({ type: "merge_instance", instanceId });
  };

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

  const handleRemoveProject = (target: RemoveProjectTarget) => {
    const project = projectByDir.get(target.directory);
    if (project) {
      setConfirmRemoveProject(project);
      return;
    }
    setConfirmRemoveProject({
      id: target.id,
      name: target.name,
      directory: target.directory,
    });
  };

  const handleRenameSpace = (spaceId: string, name: string) => {
    send({ type: "rename_space", spaceId, name });
  };

  const confirmRemoveAction = async () => {
    const project = confirmRemoveProject;
    const projectId = project?.id;
    if (!projectId) return;

    try {
      await apiRemoveProject(projectId);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      if (currentProjectId === projectId) {
        navigate({ to: "/" });
      }
      toast.success(`Removed "${project.name}"`);
      setConfirmRemoveProject(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove project");
    }
  };

  const confirmDeleteInstanceAction = () => {
    const instance = confirmRemoveInstance;
    if (!instance) return;
    trackInstanceRemove(instance);
    send({ type: "remove_instance", instanceId: instance.id });
    setConfirmRemoveInstance(null);
  };

  const handleCreateSpace = (dir: string) => {
    spaceDialog.open(dir);
  };

  const handleCompleteSpace = (spaceId: string) => {
    setConfirmCompleteSpaceId(spaceId);
  };

  const confirmCompleteSpaceAction = async () => {
    if (!confirmCompleteSpaceId) return;
    const spaceId = confirmCompleteSpaceId;
    setConfirmCompleteSpaceId(null);
    try {
      await completeSpace(spaceId);
      toast.success("Space merged");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to complete space");
    }
  };

  const handleDeleteSpace = async (spaceId: string) => {
    try {
      await deleteSpace(spaceId);
      if (currentSpaceId === spaceId && currentProjectId) {
        navigate({ to: "/projects/$projectId", params: { projectId: currentProjectId } });
      }
      toast.success("Space deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete space");
    }
  };

  const hasProjects = projects.length > 0;

  return (
    <aside
      className="flex h-full w-full flex-col border-r border-border/70 bg-surface"
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
                <Badge variant="warning" size="xs">
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
              <Popover.Trigger
                render={
                  <Button
                    variant="icon"
                    className="rounded-lg border border-border/60 hover:border-border-hover"
                  />
                }
              >
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
            {groups.map(([dir, groupInstances], index) => (
              <SidebarProjectGroup
                key={dir}
                dir={dir}
                project={projectByDir.get(dir)}
                groupInstances={groupInstances}
                currentId={currentId}
                currentProjectId={currentProjectId}
                locationPathname={location.pathname}
                iconPath={projectIcons[dir]}
                isOpen={!collapsedDirs.has(dir)}
                onToggle={() => toggleDir(dir)}
                sessionIdMap={sessionIdMap}
                onQuickCreate={handleQuickCreate}
                onDelete={handleDelete}
                onRename={handleRename}
                onMerge={handleMerge}
                onRemoveProject={handleRemoveProject}
                isFirst={index === 0}
                isLast={index === groups.length - 1}
                onMoveToTop={() => moveToTop(dir)}
                onMoveUp={() => moveUp(dir)}
                onMoveDown={() => moveDown(dir)}
                onMoveToBottom={() => moveToBottom(dir)}
                spaces={projectSpaces[dir]}
                activeSpaceId={currentSpaceId}
                onCreateSpace={handleCreateSpace}
                onRenameSpace={handleRenameSpace}
                onCompleteSpace={handleCompleteSpace}
                onDeleteSpace={handleDeleteSpace}
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
        <div className="sidebar-footer flex items-center justify-between px-4 py-2">
          <Link to="/settings">
            <Button variant="ghost" size="sm">
              <Settings size={14} />
              Settings
            </Button>
          </Link>
          {isAuthenticated && (
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut size={13} />
              Sign out
            </Button>
          )}
        </div>
      </div>

      <ConfirmActionDialog
        open={!!confirmRemoveInstance}
        onOpenChange={(open) => !open && setConfirmRemoveInstance(null)}
        title="Delete chat?"
        description={
          confirmRemoveInstance ? (
            <>
              <span className="font-medium text-text">{confirmRemoveInstance.name}</span> will be
              removed from Relay. Chat history is preserved on disk if it can be recovered later,
              but this sidebar entry will be deleted now.
            </>
          ) : null
        }
        confirmLabel="Delete"
        onConfirm={confirmDeleteInstanceAction}
      />

      <ConfirmActionDialog
        open={!!confirmRemoveProject}
        onOpenChange={(open) => !open && setConfirmRemoveProject(null)}
        title="Remove project?"
        description={
          confirmRemoveProject ? (
            <>
              <span className="font-medium text-text">{confirmRemoveProject.name}</span> will be
              removed from Relay. Session history is preserved but won&apos;t appear in the sidebar
              until the project is re-added.
            </>
          ) : null
        }
        confirmLabel="Remove"
        onConfirm={confirmRemoveAction}
      />

      <ConfirmMergeDialog
        open={!!confirmCompleteSpaceId}
        onConfirm={confirmCompleteSpaceAction}
        onCancel={() => setConfirmCompleteSpaceId(null)}
      />

      <CreateSpaceDialog
        dir={spaceDialog.dir}
        projectName={
          spaceDialog.dir ? (projectByDir.get(spaceDialog.dir)?.name ?? spaceDialog.dir) : ""
        }
        projectId={spaceDialog.dir ? projectByDir.get(spaceDialog.dir)?.id : undefined}
        defaultBaseBranch={
          spaceDialog.dir
            ? (projectByDir.get(spaceDialog.dir)?.defaultSpaceBranch ?? undefined)
            : undefined
        }
        spaceBranchSource={
          spaceDialog.dir
            ? (projectByDir.get(spaceDialog.dir)?.spaceBranchSource ?? undefined)
            : undefined
        }
        onOpenChange={(open) => !open && spaceDialog.close()}
      />
    </aside>
  );
}
