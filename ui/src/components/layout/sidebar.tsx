import { useState, useRef, useEffect } from "react";
import { useNavigate, useParams, useLocation, Link } from "@tanstack/react-router";
import { Loader2, LogOut, Moon, Plus, Sun } from "lucide-react";
import { useWSMethods, useWSState } from "../../context/websocket-context";
import { useAuthContext } from "../../context/auth-context";
import { useTheme } from "../../context/theme-context";
import { RelayLogo } from "../ui/relay-logo";
import { Popover } from "../ui/popover";
import { SidebarProjectGroup } from "./sidebar-project-group";

import { NewInstanceForm } from "../forms/new-instance-form";
import { fetchBeadsProjects } from "../../lib/api";
import type { InstanceInfo } from "@shared/types";

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

  // Build a sessionId->instance lookup for parent linking
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
            <p className="text-sm text-muted">Syncing chats...</p>
          </div>
        ) : instances.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
            <p className="mb-1 text-sm text-muted">No instances running</p>
            <span className="text-xs text-muted opacity-60">Create one to get started</span>
          </div>
        ) : (
          <>
            {groups.map(([dir, groupInstances]) => (
              <SidebarProjectGroup
                key={dir}
                dir={dir}
                groupInstances={groupInstances}
                currentId={currentId}
                currentProjectId={currentProjectId}
                locationPathname={location.pathname}
                isOpen={!collapsedDirs.has(dir)}
                onToggle={(open) => {
                  setCollapsedDirs((prev) => {
                    const next = new Set(prev);
                    if (open) next.delete(dir);
                    else next.add(dir);
                    return next;
                  });
                }}
                sessionIdMap={sessionIdMap}
                hasBeads={beadsDirs.has(dir)}
                onQuickCreate={handleQuickCreate}
                onDelete={handleDelete}
                onRename={handleRename}
                onRefreshTitle={handleRefreshTitle}
                onMerge={handleMerge}
              />
            ))}

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
