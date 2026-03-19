import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useLocation, Link } from "@tanstack/react-router";
import { FolderPlus, Loader2, LogOut, Moon, PanelLeftClose, Sun } from "lucide-react";
import { toast } from "sonner";
import { useWSMethods, useWSState } from "../../context/websocket-context";
import { useAuthContext } from "../../context/auth-context";
import { useTheme } from "../../context/theme-context";
import { useActionToasts } from "../../hooks/use-action-toasts";
import { RelayLogo } from "../ui/relay-logo";
import { Popover } from "../ui/popover";
import { Button } from "../ui/button";
import { ConfirmActionDialog } from "../ui/confirm-action-dialog";
import { SidebarProjectGroup } from "./sidebar-project-group";

import { AddProjectForm } from "../forms/add-project-form";
import {
  addProject as apiAddProject,
  removeProject as apiRemoveProject,
  fetchProjectIcons,
} from "../../lib/api";
import { getInstanceProjectRouteId, type RemoveProjectTarget } from "../../lib/project-route";
import { useProjectOrder } from "../../hooks/use-project-order";
import type { InstanceInfo, Project } from "@shared/types";

export function Sidebar({ onCollapse }: { onCollapse?: () => void } = {}) {
  const { send } = useWSMethods();
  const { isConnected, isSyncing, instances, projects } = useWSState();
  const { trackInstanceCreate, trackInstanceRemove, trackInstanceMerge } = useActionToasts();
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
  const [showAddProject, setShowAddProject] = useState(false);
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  const [confirmRemoveInstance, setConfirmRemoveInstance] = useState<Pick<
    InstanceInfo,
    "id" | "name"
  > | null>(null);
  const [confirmRemoveProject, setConfirmRemoveProject] = useState<RemoveProjectTarget | null>(
    null,
  );
  const prevInstanceIds = useRef(new Set<string>());
  const pendingCreate = useRef(false);

  // Project ordering
  const {
    sortEntries,
    moveToTop,
    moveUp,
    moveDown,
    moveToBottom,
    syncVisibleDirs,
    collapsed: collapsedDirs,
    toggleCollapsed: toggleDir,
  } = useProjectOrder();

  // Project icons
  const { data: projectIcons = {} } = useQuery({
    queryKey: ["projectIcons"],
    queryFn: fetchProjectIcons,
  });

  // Navigate to newly created instance
  useEffect(() => {
    const currentIds = new Set(instances.map((i) => i.id));
    if (pendingCreate.current && prevInstanceIds.current.size > 0) {
      for (const inst of instances) {
        if (!prevInstanceIds.current.has(inst.id) && !inst.external) {
          pendingCreate.current = false;
          navigate({
            to: "/projects/$projectId/chats/$chatId",
            params: { projectId: getInstanceProjectRouteId(inst), chatId: inst.id },
          });
          break;
        }
      }
    }
    prevInstanceIds.current = currentIds;
  }, [instances, navigate]);

  // Build project lookup by directory
  const projectByDir = new Map<string, Project>();
  for (const proj of projects) {
    projectByDir.set(proj.directory, proj);
  }

  // Group instances by working directory, but only for still-registered projects.
  const registeredDirs = new Set(projects.map((p) => p.directory));
  const groupMap = new Map<string, InstanceInfo[]>();
  for (const inst of instances) {
    const dir = inst.workingDirectory;
    if (registeredDirs.size > 0 && !registeredDirs.has(dir)) continue;
    if (!groupMap.has(dir)) groupMap.set(dir, []);
    groupMap.get(dir)!.push(inst);
  }
  for (const group of groupMap.values()) {
    group.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  // Include empty project groups (registered but no sessions yet)
  for (const proj of projects) {
    if (!groupMap.has(proj.directory)) {
      groupMap.set(proj.directory, []);
    }
  }

  // Sort projects by custom order
  const groups = sortEntries([...groupMap.entries()]);

  useEffect(() => {
    syncVisibleDirs([...groupMap.keys()]);
  }, [instances, projects, syncVisibleDirs]);

  // Build a sessionId->instance lookup for parent linking
  const sessionIdMap = new Map<string, InstanceInfo>();
  for (const inst of instances) {
    if (inst.sessionId) sessionIdMap.set(inst.sessionId, inst);
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
      setShowAddProject(false);
      toast.success(`Added "${project.name}"`);
    } catch (err) {
      setAddProjectError(err instanceof Error ? err.message : "Failed to add project");
    }
  };

  const handleRemoveProject = (target: RemoveProjectTarget) => {
    // Resolve the project from WS state first — no async, no flicker
    const project = projectByDir.get(target.directory);
    if (project) {
      setConfirmRemoveProject(project);
      return;
    }

    // Fall back to what we already know from the target
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

  const hasProjects = projects.length > 0;

  return (
    <aside className="flex h-full w-full flex-col border-r border-border/70 bg-surface">
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
        <div className="flex items-center gap-1">
          <Popover.Root
            open={showAddProject}
            onOpenChange={(open) => {
              setShowAddProject(open);
              if (!open) setAddProjectError(null);
            }}
          >
            <Popover.Trigger>
              <Button variant="ghost" size="sm">
                <FolderPlus size={14} strokeWidth={2} />
                Add Project
              </Button>
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

      {/* Instance list */}
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
              />
            ))}

            {/* Subtle syncing indicator */}
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
    </aside>
  );
}
