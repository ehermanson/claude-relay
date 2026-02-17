import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useWS } from "../context/websocket-context";
import { Tooltip } from "../components/ui/tooltip";
import { fetchDashboardStats } from "../lib/api";
import { formatTokens, formatCost, formatTimeAgo } from "../lib/utils";
import type { DashboardStats, InstanceInfo } from "@shared/types";

// ─── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  subValue,
  icon,
}: {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-muted">{icon}</span>
        <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted">
          {label}
        </span>
      </div>
      <div className="text-[1.25rem] font-semibold tracking-tight text-text-bright">{value}</div>
      {subValue && <div className="mt-0.5 text-[0.6875rem] text-muted">{subValue}</div>}
    </div>
  );
}

// ─── Project Row ────────────────────────────────────────────────────────────

function ProjectRow({
  directory,
  instances,
  onClick,
}: {
  directory: string;
  instances: InstanceInfo[];
  onClick: () => void;
}) {
  const dirName = directory.split("/").pop() || directory;
  const activeCount = instances.filter(
    (i) => i.status === "processing" || i.status === "idle",
  ).length;
  const totalCost = instances.reduce((sum, i) => sum + (i.stats?.costUSD ?? 0), 0);
  const totalTokens = instances.reduce(
    (sum, i) => sum + (i.stats?.inputTokens ?? 0) + (i.stats?.outputTokens ?? 0),
    0,
  );
  const lastActivity = Math.max(...instances.map((i) => i.lastActivityAt));
  const gitInfo = instances.find((i) => i.gitInfo)?.gitInfo;

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-hover"
    >
      {/* Icon */}
      {gitInfo ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-muted"
        >
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-muted"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      )}

      {/* Name + session count */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.8125rem] font-medium text-text-bright">{dirName}</div>
        <div className="text-[0.6875rem] text-muted">
          {instances.length} session{instances.length !== 1 ? "s" : ""}
          {activeCount > 0 && <span className="text-accent"> &middot; {activeCount} active</span>}
        </div>
      </div>

      {/* Stats */}
      <div className="shrink-0 text-right">
        {totalCost > 0 && (
          <div className="text-[0.8125rem] font-medium text-text-bright">
            ~{formatCost(totalCost)}
          </div>
        )}
        {totalTokens > 0 && (
          <div className="text-[0.6875rem] text-muted">{formatTokens(totalTokens)} tokens</div>
        )}
      </div>

      {/* Last activity */}
      <div className="shrink-0 text-[0.6875rem] text-muted">{formatTimeAgo(lastActivity)}</div>
    </button>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

export function Dashboard() {
  const { instances } = useWS();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    fetchDashboardStats()
      .then(setStats)
      .catch(() => {});
    // Refresh stats every 30s
    const interval = setInterval(() => {
      fetchDashboardStats()
        .then(setStats)
        .catch(() => {});
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Aggregate current session stats from live instances (real-time via WS)
  const currentStats = useMemo(() => {
    let tokens = 0;
    let cost = 0;
    for (const inst of instances) {
      if (inst.stats) {
        tokens += inst.stats.inputTokens + inst.stats.outputTokens;
        cost += inst.stats.costUSD;
      }
    }
    return { tokens, cost };
  }, [instances]);

  // Group instances by working directory, sorted by most recent activity
  const projectGroups = useMemo(() => {
    const map = new Map<string, InstanceInfo[]>();
    for (const inst of instances) {
      const dir = inst.workingDirectory;
      if (!map.has(dir)) map.set(dir, []);
      map.get(dir)!.push(inst);
    }
    return Array.from(map.entries()).sort(
      ([, a], [, b]) =>
        Math.max(...b.map((i) => i.lastActivityAt)) - Math.max(...a.map((i) => i.lastActivityAt)),
    );
  }, [instances]);

  const activeCount = instances.filter(
    (i) => i.status === "processing" || i.status === "idle",
  ).length;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-[1.125rem] font-semibold tracking-tight text-text-bright">
            Dashboard
          </h1>
          <p className="mt-1 text-[0.8125rem] text-muted">
            {instances.length > 0
              ? `${instances.length} session${instances.length !== 1 ? "s" : ""} across ${projectGroups.length} project${projectGroups.length !== 1 ? "s" : ""}`
              : "No active sessions"}
          </p>
        </div>

        {/* Stat cards */}
        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Active"
            value={String(activeCount)}
            subValue={`${instances.length} total`}
            icon={
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
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            }
          />
          <StatCard
            label="Current Cost"
            value={currentStats.cost > 0 ? `~${formatCost(currentStats.cost)}` : "$0.00"}
            subValue={
              currentStats.tokens > 0
                ? `${formatTokens(currentStats.tokens)} tokens`
                : "No tokens used"
            }
            icon={
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
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            }
          />
          {stats && (
            <Tooltip
              content={
                <div className="flex flex-col gap-0.5">
                  <div>Input: {formatTokens(stats.allTime.inputTokens)}</div>
                  <div>Output: {formatTokens(stats.allTime.outputTokens)}</div>
                  {stats.allTime.cacheCreationTokens > 0 && (
                    <div>Cache write: {formatTokens(stats.allTime.cacheCreationTokens)}</div>
                  )}
                  {stats.allTime.cacheReadTokens > 0 && (
                    <div>Cache read: {formatTokens(stats.allTime.cacheReadTokens)}</div>
                  )}
                </div>
              }
            >
              <div>
                <StatCard
                  label="All-Time Cost"
                  value={
                    stats.allTime.costUSD > 0 ? `~${formatCost(stats.allTime.costUSD)}` : "$0.00"
                  }
                  subValue={`${formatTokens(stats.allTime.tokens)} tokens across ${stats.allTime.sessionCount} session${stats.allTime.sessionCount !== 1 ? "s" : ""}`}
                  icon={
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
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  }
                />
              </div>
            </Tooltip>
          )}
          {stats && (
            <StatCard
              label="Uptime"
              value={formatUptime(stats.uptime)}
              subValue={
                stats.connections > 0
                  ? `${stats.connections} connection${stats.connections !== 1 ? "s" : ""}`
                  : "No connections"
              }
              icon={
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
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              }
            />
          )}
        </div>

        {/* Projects */}
        {projectGroups.length > 0 && (
          <div>
            <h2 className="mb-3 text-[0.8125rem] font-semibold text-text-bright">Projects</h2>
            <div className="flex flex-col gap-2">
              {projectGroups.map(([dir, groupInstances]) => (
                <ProjectRow
                  key={dir}
                  directory={dir}
                  instances={groupInstances}
                  onClick={() =>
                    navigate({
                      to: "/projects/$projectId",
                      params: { projectId: dir.split("/").pop() || dir },
                    })
                  }
                />
              ))}
            </div>
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
              Use the + button in the sidebar to create a new session
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
