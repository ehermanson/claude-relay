import { createFileRoute, Outlet, useParams, useLocation, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useWSState } from "../../../context/websocket-context";
import { useMediaQuery } from "../../../hooks/use-media-query";
import { OpenInMenu } from "../../../components/project/open-in-menu";
import { Tooltip } from "../../../components/ui/tooltip";
import { fetchProjectArtifacts } from "../../../lib/api";
import { formatTokens, formatCost } from "../../../lib/utils";
import { ProjectContext } from "../../../context/project-context";

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

function NavTab({
  to,
  params,
  active,
  children,
}: {
  to: string;
  params: Record<string, string>;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      params={params}
      className={`relative px-3 py-2.5 text-[0.8125rem] font-medium transition-colors ${
        active ? "text-accent" : "text-muted hover:text-text"
      }`}
    >
      {children}
      {active && (
        <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-accent" />
      )}
    </Link>
  );
}

function ProjectLayout() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const { chatId, planSlug } = useParams({ strict: false }) as {
    chatId?: string;
    planSlug?: string;
  };
  const location = useLocation();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { instances } = useWSState();

  const [artifacts, setArtifacts] = useState<import("@shared/types").ProjectArtifacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    fetchProjectArtifacts(projectId)
      .then(setArtifacts)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  const isChildView = !!chatId || !!planSlug;

  // Session stats
  const sessionStats = useMemo(() => {
    const projectInstances = instances.filter(
      (inst) => inst.workingDirectory.split("/").pop() === projectId,
    );
    const activeCount = projectInstances.filter(
      (i) => i.status === "idle" || i.status === "processing",
    ).length;
    return { total: projectInstances.length, activeCount };
  }, [instances, projectId]);

  // Active tab
  const pathname = location.pathname;
  const isPlansTab = pathname.includes("/plans");
  const isIssuesTab = pathname.includes("/issues");
  const isChatsTab = pathname.includes("/chats");
  const isOverviewTab = !isPlansTab && !isIssuesTab && !isChatsTab;

  const dirName = artifacts?.directory.split("/").pop() || projectId;
  const planCount = artifacts?.plans.length ?? 0;
  const issueCount = artifacts?.beadsIssues?.length ?? 0;

  const ctxValue = useMemo(() => ({ artifacts, loading, error }), [artifacts, loading, error]);

  if (isChildView) {
    return (
      <ProjectContext.Provider value={ctxValue}>
        <Outlet />
      </ProjectContext.Provider>
    );
  }

  // Format session tab label
  let sessionLabel = "Sessions";
  if (sessionStats.total > 0) {
    sessionLabel += ` (${sessionStats.total}`;
    if (sessionStats.activeCount > 0) {
      sessionLabel += ` \u00b7 ${sessionStats.activeCount} active`;
    }
    sessionLabel += ")";
  }

  return (
    <ProjectContext.Provider value={ctxValue}>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-3">
          {isMobile && <BackButton to="/" />}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[0.9375rem] font-semibold tracking-tight text-text-bright">
              {dirName}
            </h1>
            {artifacts?.directory && (
              <p className="truncate text-xs text-muted">{artifacts.directory}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <OpenInMenu path={artifacts?.directory} />
            {artifacts?.githubUrl && (
              <Tooltip content="Open on GitHub">
                <a
                  href={artifacts.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                </a>
              </Tooltip>
            )}
            {artifacts && artifacts.stats.costUSD > 0 && (
              <Tooltip
                content={
                  <div className="flex flex-col gap-0.5">
                    <div>Input: {formatTokens(artifacts.stats.inputTokens)}</div>
                    <div>Output: {formatTokens(artifacts.stats.outputTokens)}</div>
                    {artifacts.stats.cacheCreationTokens > 0 && (
                      <div>Cache write: {formatTokens(artifacts.stats.cacheCreationTokens)}</div>
                    )}
                    {artifacts.stats.cacheReadTokens > 0 && (
                      <div>Cache read: {formatTokens(artifacts.stats.cacheReadTokens)}</div>
                    )}
                  </div>
                }
              >
                <div className="shrink-0 text-right">
                  <div className="text-[0.8125rem] font-medium text-text-bright">
                    ~{formatCost(artifacts.stats.costUSD)}
                  </div>
                  <div className="text-[0.6875rem] text-muted">
                    estimated across {artifacts.stats.sessionCount} session
                    {artifacts.stats.sessionCount !== 1 ? "s" : ""}
                  </div>
                </div>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Sub-nav */}
        <nav className="flex shrink-0 items-center gap-1 border-b border-border px-6">
          <NavTab to="/projects/$projectId" params={{ projectId }} active={isOverviewTab}>
            Overview
          </NavTab>
          <NavTab to="/projects/$projectId/plans" params={{ projectId }} active={isPlansTab}>
            Plans{!loading && planCount > 0 ? ` (${planCount})` : ""}
          </NavTab>
          {issueCount > 0 && (
            <NavTab to="/projects/$projectId/issues" params={{ projectId }} active={isIssuesTab}>
              Issues ({issueCount})
            </NavTab>
          )}
          <NavTab to="/projects/$projectId/chats" params={{ projectId }} active={isChatsTab}>
            {sessionLabel}
          </NavTab>
        </nav>

        {/* Content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>
      </div>
    </ProjectContext.Provider>
  );
}

export const Route = createFileRoute("/_app/projects/$projectId")({
  component: ProjectLayout,
});
