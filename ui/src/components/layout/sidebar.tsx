import { useState, useRef, useEffect } from "react";
import { useNavigate, useParams, useLocation, Link } from "@tanstack/react-router";
import { FolderPlus, Loader2, LogOut, Moon, PanelLeftClose, Sun } from "lucide-react";
import { useWSMethods, useWSState } from "../../context/websocket-context";
import { useAuthContext } from "../../context/auth-context";
import { useTheme } from "../../context/theme-context";
import { RelayLogo } from "../ui/relay-logo";
import { Popover } from "../ui/popover";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { SidebarProjectGroup } from "./sidebar-project-group";

import { AddProjectForm } from "../forms/add-project-form";
import {
  addProject as apiAddProject,
  removeProject as apiRemoveProject,
  fetchBeadsProjects,
  fetchProjectIcons,
} from "../../lib/api";
import { getInstanceProjectRouteId, type RemoveProjectTarget } from "../../lib/project-route";
import { useProjectOrder } from "../../hooks/use-project-order";
import type { InstanceInfo, Project } from "@shared/types";

export function Sidebar({ onCollapse }: { onCollapse?: () => void } = {}) {
  const { send } = useWSMethods();
  const { isConnected, isSyncing, instances, projects } = useWSState();
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
  const { collapsed: collapsedDirs, toggleCollapsed: toggleDir } = useProjectOrder();
  const [confirmRemoveProject, setConfirmRemoveProject] = useState<RemoveProjectTarget | null>(
    null,
  );
  const prevInstanceIds = useRef(new Set<string>());
  const pendingCreate = useRef(false);

  // Project ordering
  const { sortEntries, moveToTop, moveUp, moveDown, moveToBottom } = useProjectOrder();

  // Beads directories
  const [beadsDirs, setBeadsDirs] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetchBeadsProjects()
      .then((dirs) => setBeadsDirs(new Set(dirs)))
      .catch(() => {});
  }, []);

  // Project icons
  const [projectIcons, setProjectIcons] = useState<Record<string, string>>({});
  useEffect(() => {
    fetchProjectIcons()
      .then(setProjectIcons)
      .catch(() => {});
  }, []);

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

  // Build a sessionId->instance lookup for parent linking
  const sessionIdMap = new Map<string, InstanceInfo>();
  for (const inst of instances) {
    if (inst.sessionId) sessionIdMap.set(inst.sessionId, inst);
  }

  const handleQuickCreate = (workingDirectory: string) => {
    pendingCreate.current = true;
    send({ type: "create_instance", workingDirectory });
  };

  const handleDelete = (instanceId: string) => {
    send({ type: "remove_instance", instanceId });
  };

  const handleRename = (instanceId: string, name: string) => {
    send({ type: "rename_instance", instanceId, name });
  };

  const handleMerge = (instanceId: string) => {
    send({ type: "merge_instance", instanceId });
  };

  const handleAddProject = async (directory: string) => {
    setAddProjectError(null);
    try {
      await apiAddProject(directory);
      setShowAddProject(false);
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
    const projectId = confirmRemoveProject?.id;
    if (!projectId) return;

    try {
      await apiRemoveProject(projectId);
      if (currentProjectId === projectId) {
        navigate({ to: "/" });
      }
    } catch {
      // ignore
    }
    setConfirmRemoveProject(null);
  };

  const hasProjects = projects.length > 0;

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
        <div className="flex items-center gap-1">
          <Popover.Root
            open={showAddProject}
            onOpenChange={(open) => {
              setShowAddProject(open);
              if (!open) setAddProjectError(null);
            }}
          >
            <Popover.Trigger className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text">
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
            <button
              onClick={onCollapse}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              <PanelLeftClose size={15} strokeWidth={2} />
            </button>
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
                hasBeads={beadsDirs.has(dir)}
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
      </div>

      {/* Confirm remove project dialog */}
      <Dialog.Root
        open={!!confirmRemoveProject}
        onOpenChange={(open) => !open && setConfirmRemoveProject(null)}
      >
        {confirmRemoveProject && (
          <Dialog.Content maxWidth="max-w-xs">
            <Dialog.Header>
              <Dialog.Title>Remove project?</Dialog.Title>
              <Dialog.Close />
            </Dialog.Header>
            <p className="text-[0.8125rem] text-muted">
              <span className="font-medium text-text">{confirmRemoveProject.name}</span> will be
              removed from Relay. Session history is preserved but won&apos;t appear in the sidebar
              until the project is re-added.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmRemoveProject(null)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={confirmRemoveAction}>
                Remove
              </Button>
            </div>
          </Dialog.Content>
        )}
      </Dialog.Root>
    </aside>
  );
}
