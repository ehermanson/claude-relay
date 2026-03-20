import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { FolderPlus, Loader2, LogOut, Moon, PanelLeftClose, Sun } from "lucide-react";
import { toast } from "sonner";
import type { InstanceInfo, Project, SpaceInfo } from "@shared/types";
import { useAuthContext } from "../../context/auth-context";
import { useTheme } from "../../context/theme-context";
import { useWSMethods, useWSState } from "../../context/websocket-context";
import { useActionToasts } from "../../hooks/use-action-toasts";
import { useProjectNavigationModel } from "../../hooks/use-project-navigation-model";
import {
  addProject as apiAddProject,
  completeSpace,
  createSpace,
  deleteSpace,
  fetchProjectIcons,
  removeProject as apiRemoveProject,
} from "../../lib/api";
import { getInstanceProjectRouteId, type RemoveProjectTarget } from "../../lib/project-route";
import { AddProjectForm } from "../forms/add-project-form";
import { ConfirmMergeDialog } from "../spaces/confirm-merge-dialog";
import { Button } from "../ui/button";
import { ConfirmActionDialog } from "../ui/confirm-action-dialog";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";
import { Popover } from "../ui/popover";
import { RelayLogo } from "../ui/relay-logo";
import { SidebarProjectGroup } from "./sidebar-project-group";

export function Sidebar({ onCollapse }: { onCollapse?: () => void } = {}) {
  const queryClient = useQueryClient();
  const { send } = useWSMethods();
  const { isConnected, isSyncing, instances } = useWSState();
  const { trackInstanceCreate, trackInstanceMerge, trackInstanceRemove } = useActionToasts();
  const { logout } = useAuthContext();
  const { theme, toggle: toggleTheme } = useTheme();
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
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  const [confirmRemoveInstance, setConfirmRemoveInstance] = useState<Pick<
    InstanceInfo,
    "id" | "name"
  > | null>(null);
  const [confirmRemoveProject, setConfirmRemoveProject] = useState<RemoveProjectTarget | null>(
    null,
  );
  const [createSpaceDir, setCreateSpaceDir] = useState<string | null>(null);
  const [newSpaceName, setNewSpaceName] = useState("");
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
    setCreateSpaceDir(dir);
    setNewSpaceName("");
  };

  const confirmCreateSpace = async () => {
    if (!createSpaceDir) return;
    const project = projectByDir.get(createSpaceDir);
    if (!project) {
      toast.error("Project not found");
      return;
    }

    try {
      const space = await createSpace(project.id, {
        name: newSpaceName.trim() || undefined,
      });
      setCreateSpaceDir(null);
      await queryClient.invalidateQueries({ queryKey: ["spaces", project.id] });
      navigate({
        to: "/projects/$projectId/spaces/$spaceId",
        params: { projectId: project.id, spaceId: space.id },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create space");
    }
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
    <aside className="flex h-full w-full flex-col border-r border-border/70 bg-surface">
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
        <div className="flex items-center gap-1">
          <Popover.Root
            open={showAddProject}
            onOpenChange={(open) => {
              setShowAddProject(open);
              if (!open) setAddProjectError(null);
            }}
          >
            <Popover.Trigger render={<Button variant="ghost" size="sm" />}>
              <FolderPlus size={14} strokeWidth={2} />
              Add Project
            </Popover.Trigger>
            <Popover.Content className="w-96" align="end">
              <AddProjectForm
                onSubmit={handleAddProject}
                onCancel={() => setShowAddProject(false)}
                error={addProjectError}
                registeredDirs={registeredDirs}
              />
            </Popover.Content>
          </Popover.Root>
          {onCollapse && (
            <Button variant="icon" onClick={onCollapse}>
              <PanelLeftClose size={15} strokeWidth={2} />
            </Button>
          )}
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
        <div className="flex items-center justify-between px-4 py-2">
          <Button variant="ghost" size="sm" onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {theme === "dark" ? "Light" : "Dark"}
          </Button>
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut size={13} />
            Sign out
          </Button>
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

      <Dialog.Root
        open={!!createSpaceDir}
        onOpenChange={(open) => !open && setCreateSpaceDir(null)}
      >
        <Dialog.Content maxWidth="max-w-sm">
          <Dialog.Header>
            <Dialog.Title>Create Space</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <div className="space-y-3">
            <p className="text-[0.8125rem] text-muted">
              Create an isolated worktree for{" "}
              <span className="font-medium text-text">
                {createSpaceDir ? (projectByDir.get(createSpaceDir)?.name ?? createSpaceDir) : ""}
              </span>
              .
            </p>
            <div className="space-y-1.5">
              <label className="text-[0.75rem] font-medium text-muted" htmlFor="space-name">
                Name
              </label>
              <Input
                id="space-name"
                autoFocus
                value={newSpaceName}
                onChange={(event) => setNewSpaceName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void confirmCreateSpace();
                  }
                }}
                placeholder="Optional"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCreateSpaceDir(null)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={() => void confirmCreateSpace()}>
                Create Space
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </aside>
  );
}
