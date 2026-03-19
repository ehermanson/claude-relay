import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { BarChart3, CheckCircle2, MessageSquare, Plus } from "lucide-react";
import { useWSState, useWSMethods } from "../context/websocket-context";
import { getInstanceProjectRouteId } from "../lib/project-route";
import { Tooltip } from "../components/ui/tooltip";
import { formatTimeAgo, formatTokens, formatModel, getDisplayTokenBreakdown } from "../lib/utils";
import { ProviderLogo } from "../components/chat/input-area/shared";
import { useProjectOrder } from "../hooks/use-project-order";
import { useActionToasts } from "../hooks/use-action-toasts";
import { fetchProjectIcons, fetchProjectArtifacts } from "../lib/api";
import type { InstanceInfo, ProjectArtifacts, ProviderKind } from "@shared/types";

// ─── Project Card ────────────────────────────────────────────────────────────

function ProjectCard({
  directory,
  instances,
  projectId,
  iconPath,
  artifacts,
  onNewSession,
}: {
  directory: string;
  instances: InstanceInfo[];
  projectId: string;
  iconPath?: string;
  artifacts?: ProjectArtifacts;
  onNewSession: (dir: string) => void;
}) {
  const dirName = directory.split("/").pop() || directory;
  const activeCount = instances.filter(
    (i) => i.status === "processing" || i.status === "idle",
  ).length;
  const lastActivity = Math.max(...instances.map((i) => i.lastActivityAt));
  const [imgError, setImgError] = useState(false);
  const showIcon = iconPath && !imgError;

  // Token stats from artifacts
  const modelUsage = artifacts?.stats.modelUsage ?? [];
  const normalized = modelUsage.map(getDisplayTokenBreakdown);
  const totalTokens = normalized.reduce((s, r) => s + r.totalTokens, 0);
  const sessionCount = artifacts?.stats.sessionCount ?? instances.length;

  // Top models for display
  const topModels = [...modelUsage]
    .map((m) => ({ model: m, display: getDisplayTokenBreakdown(m) }))
    .sort((a, b) => b.display.totalTokens - a.display.totalTokens)
    .slice(0, 3);

  // Task stats
  const taskCount = artifacts?.tasks?.length ?? 0;
  const openTasks =
    artifacts?.tasks?.filter((t) => t.status === "open" || t.status === "in_progress").length ?? 0;

  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId }}
      className="group flex flex-col rounded-xl border border-border bg-surface transition-all hover:border-border-bright hover:bg-surface-hover"
    >
      {/* Header */}
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        {/* Icon */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-bg text-[0.8125rem] font-semibold text-muted">
          {showIcon ? (
            <img
              src={`/api/file?path=${encodeURIComponent(iconPath)}`}
              alt=""
              className="h-9 w-9 rounded-lg object-contain"
              onError={() => setImgError(true)}
            />
          ) : (
            dirName.charAt(0).toUpperCase()
          )}
        </div>

        {/* Name + last active */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.875rem] font-semibold text-text-bright">{dirName}</div>
          <div className="text-[0.6875rem] text-muted">
            last active: {formatTimeAgo(lastActivity)}
          </div>
        </div>

        {/* New chat button */}
        <Tooltip content={`New chat in ${dirName}`}>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onNewSession(directory);
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <Plus size={14} />
          </button>
        </Tooltip>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 overflow-hidden border-t border-border/50 px-4 py-2.5 text-[0.6875rem]">
        {/* Chats */}
        <Tooltip content={`${sessionCount} session${sessionCount !== 1 ? "s" : ""}`}>
          <span className="flex shrink-0 items-center gap-1 text-muted">
            <MessageSquare size={11} />
            {sessionCount}
          </span>
        </Tooltip>

        {/* Active indicator */}
        {activeCount > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-accent">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
            {activeCount} active
          </span>
        )}

        {/* Tokens */}
        {totalTokens > 0 && (
          <Tooltip content={`${formatTokens(totalTokens)} tokens`}>
            <span className="flex shrink-0 items-center gap-1 text-muted">
              <BarChart3 size={11} />
              {formatTokens(totalTokens)}
            </span>
          </Tooltip>
        )}

        {/* Tasks */}
        {taskCount > 0 && (
          <Tooltip
            content={`${taskCount} task${taskCount !== 1 ? "s" : ""}${openTasks > 0 ? `, ${openTasks} open` : ""}`}
          >
            <span className="flex shrink-0 items-center gap-1 text-muted">
              <CheckCircle2 size={11} />
              {openTasks > 0 ? `${openTasks} open` : `${taskCount}`}
            </span>
          </Tooltip>
        )}
      </div>

      {/* Model chips */}
      {topModels.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-hidden border-t border-border/50 px-4 py-2">
          {topModels.map(({ model: m }) => (
            <span
              key={`${m.providerName}-${m.model}`}
              className="flex shrink-0 items-center gap-1 rounded-md bg-surface-hover px-1.5 py-0.5 text-[0.625rem] text-muted"
            >
              <ProviderLogo
                provider={m.providerName as ProviderKind}
                className="h-2.5 w-2.5 shrink-0"
                muted
              />
              {formatModel(m.model)}
            </span>
          ))}
          {modelUsage.length > 3 && (
            <span className="text-[0.625rem] text-muted/50">+{modelUsage.length - 3}</span>
          )}
        </div>
      )}
    </Link>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

export function Dashboard() {
  const { instances, projects } = useWSState();
  const { send } = useWSMethods();
  const { trackInstanceCreate } = useActionToasts();
  const { sortEntries, syncVisibleDirs } = useProjectOrder();
  const navigate = useNavigate();
  const pendingCreate = useRef(false);
  const prevInstanceIds = useRef(new Set<string>());

  // Fetch project icons
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

  const handleNewSession = (workingDirectory: string) => {
    pendingCreate.current = true;
    trackInstanceCreate(workingDirectory);
    send({ type: "create_instance", workingDirectory });
  };

  // Group instances by working directory
  const projectMap = new Map<string, InstanceInfo[]>();
  for (const inst of instances) {
    const dir = inst.workingDirectory;
    if (!projectMap.has(dir)) projectMap.set(dir, []);
    projectMap.get(dir)!.push(inst);
  }

  const projectGroups = sortEntries(Array.from(projectMap.entries()));
  useEffect(() => {
    syncVisibleDirs([...projectMap.keys()]);
  }, [instances, syncVisibleDirs]);
  const projectByDir = new Map(projects.map((project) => [project.directory, project]));

  // Fetch artifacts for each project (for stats)
  const projectEntries = useMemo(
    () =>
      projectGroups.map(([dir, groupInstances]) => ({
        dir,
        id: projectByDir.get(dir)?.id ?? getInstanceProjectRouteId(groupInstances[0]),
      })),
    [projectGroups, projectByDir],
  );

  const artifactResults = useQueries({
    queries: projectEntries.map(({ id }) => ({
      queryKey: ["projectArtifacts", id],
      queryFn: () => fetchProjectArtifacts(id),
      staleTime: 60_000,
    })),
  });

  const artifactsByDir = useMemo(() => {
    const map = new Map<string, ProjectArtifacts>();
    projectEntries.forEach(({ dir }, i) => {
      const data = artifactResults[i]?.data;
      if (data) map.set(dir, data);
    });
    return map;
  }, [projectEntries, artifactResults]);

  // Aggregate stats
  const totalActive = instances.filter(
    (i) => i.status === "processing" || i.status === "idle",
  ).length;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        {/* Header */}
        <div className="mb-6 flex items-baseline justify-between">
          <div>
            <h1 className="text-[1.25rem] font-semibold tracking-tight text-text-bright">
              Projects
            </h1>
            {projectGroups.length > 0 && (
              <p className="mt-0.5 text-[0.75rem] text-muted">
                {projectGroups.length} project{projectGroups.length !== 1 ? "s" : ""}
                {totalActive > 0 && (
                  <span className="text-accent">
                    {" "}
                    · {totalActive} active session{totalActive !== 1 ? "s" : ""}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>

        {/* Project grid */}
        {projectGroups.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projectGroups.map(([dir, groupInstances]) => {
              const pid = projectByDir.get(dir)?.id ?? getInstanceProjectRouteId(groupInstances[0]);
              return (
                <ProjectCard
                  key={dir}
                  directory={dir}
                  instances={groupInstances}
                  projectId={pid}
                  iconPath={projectIcons[dir]}
                  artifacts={artifactsByDir.get(dir)}
                  onNewSession={handleNewSession}
                />
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {instances.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
            <MessageSquare size={32} strokeWidth={1.5} className="mb-3 text-muted/40" />
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
