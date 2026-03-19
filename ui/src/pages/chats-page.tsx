import { useMemo } from "react";
import { useParams, Link } from "@tanstack/react-router";
import { GitBranch } from "lucide-react";
import { useWSState } from "../context/websocket-context";
import { useProjectContext } from "../context/project-context";
import { useMediaQuery } from "../hooks/use-media-query";
import { Tooltip } from "../components/ui/tooltip";
import { Badge } from "../components/ui/badge";
import { instanceMatchesProject } from "../lib/project-route";
import { formatTimeAgo, formatTokens, formatModel } from "../lib/utils";
import type { InstanceInfo } from "@shared/types";

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

        {/* Mobile: inline model */}
        {isMobile && instance.stats?.model && (
          <div className="mt-1 flex items-center gap-2 text-[0.625rem] text-muted">
            <span>{formatModel(instance.stats.model)}</span>
          </div>
        )}
      </div>

      {/* Git branch badge */}
      {instance.gitBranch && (
        <Badge variant="default" className="hidden shrink-0 sm:flex">
          <GitBranch size={10} className="mr-1" />
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
  const { projectId: routeProjectId } = useParams({ strict: false }) as { projectId: string };
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { instances } = useWSState();
  const { artifacts } = useProjectContext();
  const projectId = artifacts.projectId || routeProjectId;

  // Filter instances for this project (same matching logic as sidebar)
  const projectInstances = useMemo(() => {
    return instances
      .filter((inst) => instanceMatchesProject(inst, projectId))
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

  return (
    <div className="flex-1 overflow-y-auto">
      {projectInstances.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="mb-1 text-sm text-muted">No chats found</p>
          <span className="text-xs text-muted opacity-60">
            Chats for this project will appear here
          </span>
        </div>
      ) : (
        <div className="mx-auto px-6 py-4">
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
  );
}
