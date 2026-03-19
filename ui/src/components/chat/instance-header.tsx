/**
 * Header bar for the chat instance view — status dot, title, metadata,
 * and action buttons (open-in, debug, sidecar toggles).
 */

import { Link } from "@tanstack/react-router";
import {
  Bug,
  ChevronLeft,
  Columns2,
  FileText,
  GitBranch,
  LayoutGrid,
  ListChecks,
  ScrollText,
} from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import { OpenInMenu } from "../project/open-in-menu";
import { ContextRing } from "./input-area/shared";
import { getInstanceProjectRouteId, getProjectName } from "../../lib/project-route";
import { formatTokens } from "../../lib/utils";
import type { InstanceInfo, SessionStats } from "@shared/types";
import type { SidecarTab } from "./sidecar";

// ── Sidecar toggle buttons ───────────────────────────────────────────

interface SidecarTogglesProps {
  isMobile: boolean;
  activePanels: Set<SidecarTab>;
  hasTasksContent: boolean;
  hasFilesContent: boolean;
  hasPlanContent: boolean;
  hasStats: boolean;
  stats?: SessionStats;
  sidecarContentCount: number;
  onTogglePanel: (panel: SidecarTab) => void;
  onOpenMobileSidecar: () => void;
}

function SidecarToggles({
  isMobile,
  activePanels,
  hasTasksContent,
  hasFilesContent,
  hasPlanContent,
  hasStats,
  stats,
  sidecarContentCount,
  onTogglePanel,
  onOpenMobileSidecar,
}: SidecarTogglesProps) {
  const hasAny = hasTasksContent || hasFilesContent || hasPlanContent || hasStats;
  if (!hasAny) return null;

  return (
    <>
      <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border/60" />
      {/* Desktop: per-panel toggle buttons */}
      {!isMobile && (
        <>
          {hasTasksContent && (
            <Tooltip content={activePanels.has("tasks") ? "Hide tasks" : "Show tasks"}>
              <Button
                variant="icon"
                toggled={activePanels.has("tasks")}
                onClick={() => onTogglePanel("tasks")}
                className="shrink-0"
              >
                <ListChecks size={15} strokeWidth={2} />
              </Button>
            </Tooltip>
          )}
          {hasFilesContent && (
            <Tooltip content={activePanels.has("files") ? "Hide files" : "Show files"}>
              <Button
                variant="icon"
                toggled={activePanels.has("files")}
                onClick={() => onTogglePanel("files")}
                className="shrink-0"
              >
                <FileText size={15} strokeWidth={2} />
              </Button>
            </Tooltip>
          )}
          {hasPlanContent && (
            <Tooltip content={activePanels.has("plan") ? "Hide plan" : "Show plan"}>
              <Button
                variant="icon"
                toggled={activePanels.has("plan")}
                onClick={() => onTogglePanel("plan")}
                className="shrink-0"
              >
                <ScrollText size={15} strokeWidth={2} />
              </Button>
            </Tooltip>
          )}
          {hasStats && stats && (
            <ContextRing
              stats={stats}
              active={activePanels.has("context")}
              onClick={() => onTogglePanel("context")}
            />
          )}
        </>
      )}
      {/* Mobile: single sidecar button */}
      {isMobile && sidecarContentCount > 0 && (
        <Tooltip content="Sidecar">
          <Button variant="icon" onClick={onOpenMobileSidecar} className="relative shrink-0">
            <LayoutGrid size={15} strokeWidth={2} />
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-claude px-0.5 text-[0.5625rem] font-semibold leading-none text-white">
              {sidecarContentCount}
            </span>
          </Button>
        </Tooltip>
      )}
    </>
  );
}

// ── Header ───────────────────────────────────────────────────────────

interface InstanceHeaderProps {
  instance: InstanceInfo;
  isMobile: boolean;
  activePanels: Set<SidecarTab>;
  hasTasksContent: boolean;
  hasFilesContent: boolean;
  hasPlanContent: boolean;
  hasStats: boolean;
  sidecarContentCount: number;
  onTogglePanel: (panel: SidecarTab) => void;
  onOpenDebug: () => void;
  onOpenMobileSidecar: () => void;
  onSplit?: () => void;
}

export function InstanceHeader({
  instance,
  isMobile,
  activePanels,
  hasTasksContent,
  hasFilesContent,
  hasPlanContent,
  hasStats,
  sidecarContentCount,
  onTogglePanel,
  onOpenDebug,
  onOpenMobileSidecar,
  onSplit,
}: InstanceHeaderProps) {
  const isStopped = instance.status === "stopped";

  // Status dot + label
  let dotClass: string;
  let statusLabel: string;
  if (isStopped) {
    dotClass = "bg-muted";
    statusLabel = instance.external ? "External chat (ended)" : "Ended";
  } else if (instance.status === "processing") {
    dotClass = "animate-pulse-dot bg-warning";
    statusLabel = instance.external ? "External chat (active)" : "Processing";
  } else if (instance.external) {
    dotClass = "bg-accent";
    statusLabel = "External chat";
  } else {
    dotClass = "bg-accent";
    statusLabel = "Idle";
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-5 py-2.5">
      <Tooltip content="Back">
        <Link
          to="/projects/$projectId/chats"
          params={{
            projectId: getInstanceProjectRouteId(instance),
          }}
          className="hidden h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text max-[768px]:flex"
        >
          <ChevronLeft size={16} strokeWidth={2} />
        </Link>
      </Tooltip>
      {/* Title area with inline status dot */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Tooltip content={statusLabel}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
          </Tooltip>
          <h1 className="truncate text-sm font-semibold tracking-tight text-text-bright">
            {instance.name}
          </h1>
        </div>
        {/* Metadata line: project . branch . tokens */}
        <div className="hidden items-center gap-1 pl-4 text-[0.6875rem] text-muted sm:flex">
          <Tooltip content={instance.workingDirectory} side="bottom">
            <Link
              to="/projects/$projectId/chats"
              params={{
                projectId: getInstanceProjectRouteId(instance),
              }}
              className="truncate transition-colors hover:text-accent"
            >
              {getProjectName(instance.workingDirectory)}
            </Link>
          </Tooltip>
          {(instance.gitBranch || instance.gitInfo?.branch) && (
            <>
              <span className="text-border">&middot;</span>
              <Tooltip
                content={
                  instance.gitBranch
                    ? `Working in worktree on branch ${instance.gitBranch}${instance.originalDirectory ? ` (from ${instance.originalDirectory})` : ""}`
                    : `On branch ${instance.gitInfo!.branch}`
                }
              >
                <span className="flex shrink-0 items-center gap-1 text-accent/70">
                  <GitBranch size={10} strokeWidth={2.5} />
                  {instance.gitBranch || instance.gitInfo!.branch}
                </span>
              </Tooltip>
            </>
          )}
          {instance.stats && instance.stats.inputTokens + instance.stats.outputTokens > 0 && (
            <>
              <span className="text-border">&middot;</span>
              <Tooltip
                content={
                  <div className="flex flex-col gap-0.5">
                    <div className="font-medium">{instance.stats.model ?? "Unknown model"}</div>
                    <div>Input: {formatTokens(instance.stats.inputTokens)}</div>
                    <div>Output: {formatTokens(instance.stats.outputTokens)}</div>
                    <div>Cache write: {formatTokens(instance.stats.cacheCreationTokens)}</div>
                    <div>Cache read: {formatTokens(instance.stats.cacheReadTokens)}</div>
                  </div>
                }
              >
                <span className="shrink-0">
                  {formatTokens(instance.stats.inputTokens + instance.stats.outputTokens)} tokens
                </span>
              </Tooltip>
            </>
          )}
        </div>
      </div>
      {/* Action buttons: [Open in X] | [Debug] | [Sidecar Controls] */}
      <div className="flex items-center gap-1">
        <OpenInMenu path={instance.workingDirectory} className="hidden sm:flex" />
        {onSplit && !isMobile && (
          <Tooltip content="Split view">
            <Button variant="icon" onClick={onSplit} className="shrink-0">
              <Columns2 size={15} strokeWidth={2} />
            </Button>
          </Tooltip>
        )}
        <Tooltip content="Debug chat data">
          <Button variant="icon" onClick={onOpenDebug} className="shrink-0">
            <Bug size={15} strokeWidth={2} />
          </Button>
        </Tooltip>
        <SidecarToggles
          isMobile={isMobile}
          activePanels={activePanels}
          hasTasksContent={hasTasksContent}
          hasFilesContent={hasFilesContent}
          hasPlanContent={hasPlanContent}
          hasStats={hasStats}
          stats={instance.stats}
          sidecarContentCount={sidecarContentCount}
          onTogglePanel={onTogglePanel}
          onOpenMobileSidecar={onOpenMobileSidecar}
        />
      </div>
    </div>
  );
}
