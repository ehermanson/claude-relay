import { useMemo } from "react";
import { useParams, Link } from "@tanstack/react-router";
import { useWSState } from "../context/websocket-context";
import { useMediaQuery } from "../hooks/use-media-query";
import { Tooltip } from "../components/ui/tooltip";
import { Badge } from "../components/ui/badge";
import { formatTimeAgo, formatTokens, formatCost, formatModel } from "../lib/utils";
import type { InstanceInfo } from "@shared/types";

function BackButton({ to }: { to: string }) {
  return (
    <Tooltip content="Back">
      <Link
        to={to}
        className="hidden h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text max-[768px]:flex"
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
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </Link>
    </Tooltip>
  );
}

function StatusDot({ instance }: { instance: InstanceInfo }) {
  const hasPendingTool = !!instance.pendingTool;
  return (
    <span
      className={`h-[6px] w-[6px] shrink-0 rounded-full ${
        hasPendingTool
          ? "animate-pulse-dot bg-warning"
          : instance.status === "idle"
            ? "bg-accent"
            : instance.status === "processing"
              ? "animate-pulse-dot bg-warning"
              : instance.status === "error"
                ? "bg-error"
                : "bg-muted"
      }`}
    />
  );
}

function SessionCard({
  instance,
  projectId,
  parentName,
  isMobile,
}: {
  instance: InstanceInfo;
  projectId: string;
  parentName?: string;
  isMobile: boolean;
}) {
  return (
    <Link
      to="/projects/$projectId/chats/$chatId"
      params={{ projectId, chatId: instance.id }}
      className="group flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-accent/30 hover:bg-surface-hover"
    >
      {/* Status dot */}
      <StatusDot instance={instance} />

      {/* Main column — name, preview, parent */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.8125rem] font-medium text-text-bright">
          {instance.name}
        </div>
        {parentName && (
          <div className="mt-0.5 truncate text-[0.6875rem] text-muted">
            {"\u21B3"} from {parentName}
          </div>
        )}
        {instance.lastMessage && (
          <div className="mt-0.5 truncate text-[0.6875rem] text-muted">
            {instance.lastMessage.text}
          </div>
        )}

        {/* Mobile: inline model + cost */}
        {isMobile && instance.stats && (
          <div className="mt-1 flex items-center gap-2 text-[0.625rem] text-muted">
            {instance.stats.model && <span>{formatModel(instance.stats.model)}</span>}
            {instance.stats.costUSD > 0 && <span>~{formatCost(instance.stats.costUSD)}</span>}
          </div>
        )}
      </div>

      {/* Git branch badge */}
      {instance.gitBranch && (
        <Badge variant="default" className="hidden shrink-0 sm:flex">
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mr-1"
          >
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <span className="max-w-[120px] truncate">{instance.gitBranch}</span>
        </Badge>
      )}

      {/* Model + cost column (desktop) */}
      {!isMobile && instance.stats && (
        <div className="hidden shrink-0 text-right sm:block">
          {instance.stats.model && (
            <div className="text-[0.6875rem] text-muted">{formatModel(instance.stats.model)}</div>
          )}
          <Tooltip
            content={
              <div className="flex flex-col gap-0.5">
                <div>Input: {formatTokens(instance.stats.inputTokens)}</div>
                <div>Output: {formatTokens(instance.stats.outputTokens)}</div>
                {instance.stats.cacheCreationTokens > 0 && (
                  <div>Cache write: {formatTokens(instance.stats.cacheCreationTokens)}</div>
                )}
                {instance.stats.cacheReadTokens > 0 && (
                  <div>Cache read: {formatTokens(instance.stats.cacheReadTokens)}</div>
                )}
              </div>
            }
          >
            <div className="text-[0.6875rem] text-muted">
              {formatTokens(instance.stats.inputTokens + instance.stats.outputTokens)} tokens
              {instance.stats.costUSD > 0 && <> · ~{formatCost(instance.stats.costUSD)}</>}
            </div>
          </Tooltip>
        </div>
      )}

      {/* Timestamps column */}
      <div className="hidden shrink-0 text-right sm:block">
        {instance.lastActivityAt > 0 && (
          <div className="text-[0.6875rem] text-muted">
            {formatTimeAgo(instance.lastActivityAt)}
          </div>
        )}
        {instance.createdAt > 0 && (
          <div className="text-[0.625rem] text-muted opacity-60">
            {new Date(instance.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </div>
        )}
      </div>
    </Link>
  );
}

export function ChatsPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { instances } = useWSState();

  // Filter instances for this project (same matching logic as sidebar)
  const projectInstances = useMemo(() => {
    return instances
      .filter((inst) => {
        const dirName = inst.workingDirectory.split("/").pop();
        return dirName === projectId;
      })
      .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
  }, [instances, projectId]);

  // Build a lookup for parent session names
  const parentNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const inst of projectInstances) {
      if (inst.parentSessionId) {
        const parent = instances.find((i) => i.sessionId === inst.parentSessionId);
        if (parent) map.set(inst.id, parent.name);
      }
    }
    return map;
  }, [projectInstances, instances]);

  // Aggregate stats
  const stats = useMemo(() => {
    let totalCost = 0;
    let activeCount = 0;
    for (const inst of projectInstances) {
      if (inst.stats?.costUSD) totalCost += inst.stats.costUSD;
      if (inst.status === "idle" || inst.status === "processing") activeCount++;
    }
    return { totalCost, activeCount, total: projectInstances.length };
  }, [projectInstances]);

  const dirPath = projectInstances[0]?.workingDirectory || "";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-3">
        {isMobile && <BackButton to={`/projects/${projectId}`} />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[0.9375rem] font-semibold tracking-tight text-text-bright">
            {projectId}
            <span className="ml-2 font-normal text-muted">— Sessions</span>
          </h1>
          {dirPath && <p className="truncate text-xs text-muted">{dirPath}</p>}
        </div>
        <div className="shrink-0 text-right text-[0.6875rem] text-muted">
          <div>
            {stats.total} session{stats.total !== 1 ? "s" : ""}
            {stats.activeCount > 0 && (
              <>
                {" · "}
                <span className="text-accent">{stats.activeCount} active</span>
              </>
            )}
          </div>
          {stats.totalCost > 0 && <div>~{formatCost(stats.totalCost)}</div>}
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {projectInstances.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="mb-1 text-sm text-muted">No sessions found</p>
            <span className="text-xs text-muted opacity-60">
              Sessions for this project will appear here
            </span>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl px-6 py-4">
            <div className="flex flex-col gap-2">
              {projectInstances.map((inst) => (
                <SessionCard
                  key={inst.id}
                  instance={inst}
                  projectId={projectId}
                  parentName={parentNames.get(inst.id)}
                  isMobile={isMobile}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
