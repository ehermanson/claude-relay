import { useEffect, useRef } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useWSState, useWSMethods } from "../context/websocket-context";
import { Tooltip } from "../components/ui/tooltip";
import { formatTimeAgo } from "../lib/utils";
import type { InstanceInfo } from "@shared/types";

// ─── Project Row ────────────────────────────────────────────────────────────

function ProjectRow({
  directory,
  instances,
  projectId,
  onNewSession,
}: {
  directory: string;
  instances: InstanceInfo[];
  projectId: string;
  onNewSession: (dir: string) => void;
}) {
  const dirName = directory.split("/").pop() || directory;
  const activeCount = instances.filter(
    (i) => i.status === "processing" || i.status === "idle",
  ).length;
  const lastActivity = Math.max(...instances.map((i) => i.lastActivityAt));

  return (
    <div className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-hover">
      <Link to="/projects/$projectId" params={{ projectId }} className="min-w-0 flex-1">
        <div className="truncate text-[0.8125rem] font-medium text-text-bright">{dirName}</div>
        <div className="text-[0.6875rem] text-muted">
          {instances.length} chat{instances.length !== 1 ? "s" : ""}
          {activeCount > 0 && <span className="text-accent"> &middot; {activeCount} active</span>}
        </div>
      </Link>

      <div className="shrink-0 text-[0.6875rem] text-muted">{formatTimeAgo(lastActivity)}</div>

      <Tooltip content={`New chat in ${dirName}`}>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onNewSession(directory);
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text"
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
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </Tooltip>
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

export function Dashboard() {
  const { instances } = useWSState();
  const { send } = useWSMethods();
  const navigate = useNavigate();
  const pendingCreate = useRef(false);
  const prevInstanceIds = useRef(new Set<string>());

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

  const handleNewSession = (workingDirectory: string) => {
    pendingCreate.current = true;
    send({ type: "create_instance", workingDirectory });
  };

  // Group instances by working directory
  const projectMap = new Map<string, InstanceInfo[]>();
  for (const inst of instances) {
    const dir = inst.workingDirectory;
    if (!projectMap.has(dir)) projectMap.set(dir, []);
    projectMap.get(dir)!.push(inst);
  }
  // Sort projects alphabetically for a stable order
  const projectGroups = Array.from(projectMap.entries()).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-[1.125rem] font-semibold tracking-tight text-text-bright">
            Projects
          </h1>
        </div>

        {/* Projects */}
        {projectGroups.length > 0 && (
          <div className="mb-8 flex flex-col gap-2">
            {projectGroups.map(([dir, groupInstances]) => (
              <ProjectRow
                key={dir}
                directory={dir}
                instances={groupInstances}
                projectId={dir.split("/").pop() || dir}
                onNewSession={handleNewSession}
              />
            ))}
          </div>
        )}

        {/* Empty state hint */}
        {instances.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mb-3 text-muted/40"
            >
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p className="mb-1 text-[0.8125rem] font-medium text-text">
              Create an instance to get started
            </p>
            <span className="text-[0.75rem] text-muted">
              Use the + button in the sidebar to create a new chat
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
