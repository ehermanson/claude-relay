import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useWS } from "../../context/WebSocketContext";
import { useAuthContext } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import { SidebarItem } from "./SidebarItem";
import { NewInstanceForm } from "../forms/NewInstanceForm";
import type { InstanceInfo } from "@shared/types";

export function Sidebar() {
  const { isConnected, instances, send } = useWS();
  const { logout } = useAuthContext();
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const { id: currentId } = useParams<{ id: string }>();
  const [showForm, setShowForm] = useState(false);
  const prevInstanceIds = useRef(new Set<string>());
  const pendingCreate = useRef(false);

  // Navigate to newly created instance
  useEffect(() => {
    const currentIds = new Set(instances.map((i) => i.id));
    if (pendingCreate.current && prevInstanceIds.current.size > 0) {
      for (const inst of instances) {
        if (!prevInstanceIds.current.has(inst.id) && !inst.external) {
          pendingCreate.current = false;
          navigate(`/chat/${inst.id}`);
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
    return map;
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
    [send]
  );

  const handleQuickCreate = useCallback(
    (workingDirectory: string) => {
      pendingCreate.current = true;
      send({ type: "create_instance", workingDirectory });
    },
    [send]
  );

  const handleDelete = useCallback(
    (instanceId: string) => {
      send({ type: "remove_instance", instanceId });
    },
    [send]
  );

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-border bg-surface max-[768px]:w-full">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight text-text-bright">
            Claude Relay
          </span>
          <span
            className={`h-[7px] w-[7px] rounded-full transition-all ${
              isConnected
                ? "bg-success shadow-[0_0_8px_var(--color-accent-glow)]"
                : "bg-muted"
            }`}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowForm(!showForm)}
            title="New instance"
            className="flex h-7 w-7 items-center justify-center rounded border border-transparent bg-transparent text-muted transition-all hover:border-accent hover:text-accent"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="flex h-7 w-7 items-center justify-center rounded border border-transparent bg-transparent text-muted transition-all hover:border-border-hover hover:text-text"
          >
            {theme === "dark" ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
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
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <button
            onClick={logout}
            className="rounded border border-border bg-transparent px-2.5 py-1 font-mono text-[0.625rem] tracking-wide text-muted transition-all hover:border-border-hover hover:text-text"
          >
            Logout
          </button>
        </div>
      </div>

      {/* New instance form */}
      {showForm && (
        <NewInstanceForm
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* Instance list */}
      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar-thumb]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-border">
        {instances.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center p-10 text-center text-muted">
            <p className="mb-1 text-xs">No instances running</p>
            <span className="text-[0.625rem] opacity-70">
              Create one to get started
            </span>
          </div>
        ) : (
          Array.from(groups.entries()).map(([dir, groupInstances]) => {
            const dirName = dir.split("/").pop() || dir;
            return (
              <div key={dir} className="border-b border-border">
                {/* Project header */}
                <div className="group flex items-center gap-2 px-4 pt-3 pb-1">
                  <svg
                    className="h-3.5 w-3.5 shrink-0 text-muted"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  <span className="min-w-0 flex-1 truncate text-xs font-bold tracking-tight text-text-bright">
                    {dirName}
                  </span>
                  <button
                    onClick={() => handleQuickCreate(dir)}
                    title={`New instance in ${dirName}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-transparent bg-transparent text-muted opacity-0 transition-all group-hover:opacity-60 hover:!border-accent hover:!text-accent hover:!opacity-100"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </button>
                </div>

                {/* Instance items */}
                {groupInstances.map((inst) => (
                  <SidebarItem
                    key={inst.id}
                    instance={inst}
                    isActive={inst.id === currentId}
                    onClick={() => navigate(`/chat/${inst.id}`)}
                    onDelete={
                      inst.external
                        ? undefined
                        : () => handleDelete(inst.id)
                    }
                  />
                ))}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
