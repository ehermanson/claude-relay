import { createFileRoute, Outlet, useParams, useLocation, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { motion } from "motion/react";
import { useWSState } from "../../../context/websocket-context";
import { useMediaQuery } from "../../../hooks/use-media-query";
import { OpenInMenu } from "../../../components/project/open-in-menu";
import { RelayLogo } from "../../../components/ui/relay-logo";
import { Tooltip } from "../../../components/ui/tooltip";
import { fetchProjectArtifacts } from "../../../lib/api";
import { getProjectName, instanceMatchesProject } from "../../../lib/project-route";
import { formatTokens } from "../../../lib/utils";
import { ProjectContext } from "../../../context/project-context";

const MotionLogo = motion.create(RelayLogo);

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
  const { chatId, planSlug } = useParams({ strict: false }) as {
    chatId?: string;
    planSlug?: string;
  };
  const location = useLocation();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { instances } = useWSState();

  const artifacts = Route.useLoaderData();
  const projectId = artifacts.projectId;
  const dirName = getProjectName(artifacts.directory);

  const isChildView = !!chatId || !!planSlug;

  // Session stats
  const sessionStats = useMemo(() => {
    const projectInstances = instances.filter((inst) => instanceMatchesProject(inst, projectId));
    const activeCount = projectInstances.filter(
      (i) => i.status === "idle" || i.status === "processing",
    ).length;
    return { total: projectInstances.length, activeCount };
  }, [instances, projectId]);

  // Active tab
  const pathname = location.pathname;
  const isPlansTab = pathname.includes("/plans");
  const isIssuesTab = pathname.includes("/issues");
  const isSkillsTab = pathname.includes("/skills");
  const isChatsTab = pathname.includes("/chats");
  const isOverviewTab = !isPlansTab && !isIssuesTab && !isSkillsTab && !isChatsTab;

  const planCount = artifacts.plans.length;
  const issueCount = artifacts.beadsIssues?.length ?? 0;
  const skillCount = artifacts.skills.length;

  const ctxValue = useMemo(() => ({ artifacts }), [artifacts]);

  if (isChildView) {
    return (
      <ProjectContext.Provider value={ctxValue}>
        <Outlet />
      </ProjectContext.Provider>
    );
  }

  // Format session tab label
  let sessionLabel = "Chats";
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
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-2.5">
          {isMobile && <BackButton to="/" />}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold tracking-tight text-text-bright">
              {dirName}
            </h1>
            {/* Metadata line: path · cost */}
            <div className="flex items-center gap-1 text-[0.6875rem] text-muted">
              <Tooltip content={artifacts.directory} side="bottom">
                <span className="hidden truncate sm:inline">{artifacts.directory}</span>
              </Tooltip>
              {artifacts.stats.inputTokens + artifacts.stats.outputTokens > 0 && (
                <>
                  <span className="hidden text-border sm:inline">·</span>
                  <Tooltip
                    content={
                      <div className="flex flex-col gap-0.5">
                        <div>Input: {formatTokens(artifacts.stats.inputTokens)}</div>
                        <div>Output: {formatTokens(artifacts.stats.outputTokens)}</div>
                        {artifacts.stats.cacheCreationTokens > 0 && (
                          <div>
                            Cache write: {formatTokens(artifacts.stats.cacheCreationTokens)}
                          </div>
                        )}
                        {artifacts.stats.cacheReadTokens > 0 && (
                          <div>Cache read: {formatTokens(artifacts.stats.cacheReadTokens)}</div>
                        )}
                      </div>
                    }
                  >
                    <span className="shrink-0">
                      {formatTokens(artifacts.stats.inputTokens + artifacts.stats.outputTokens)}{" "}
                      tokens across {artifacts.stats.sessionCount} session
                      {artifacts.stats.sessionCount !== 1 ? "s" : ""}
                    </span>
                  </Tooltip>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <OpenInMenu path={artifacts.directory} className="hidden sm:flex" />
            {artifacts.githubUrl && (
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
          </div>
        </div>

        {/* Sub-nav */}
        <nav className="flex shrink-0 items-center gap-1 border-b border-border px-6">
          <NavTab to="/projects/$projectId" params={{ projectId }} active={isOverviewTab}>
            Overview
          </NavTab>
          <NavTab to="/projects/$projectId/plans" params={{ projectId }} active={isPlansTab}>
            Plans{planCount > 0 ? ` (${planCount})` : ""}
          </NavTab>
          {issueCount > 0 && (
            <NavTab to="/projects/$projectId/issues" params={{ projectId }} active={isIssuesTab}>
              Issues ({issueCount})
            </NavTab>
          )}
          {skillCount > 0 && (
            <NavTab to="/projects/$projectId/skills" params={{ projectId }} active={isSkillsTab}>
              Skills ({skillCount})
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

function ProjectPending() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <MotionLogo
        size={112}
        connected
        showPulseRings
        initial={{ opacity: 0, scale: 0.82 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", duration: 0.9, bounce: 0.25 }}
      />
    </div>
  );
}

function ProjectError({ error }: { error: Error }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
      <p className="mb-1 text-sm font-medium text-text">Project not found</p>
      <span className="text-xs text-muted">{error.message}</span>
    </div>
  );
}

export const Route = createFileRoute("/_app/projects/$projectId")({
  loader: ({ params }) => fetchProjectArtifacts(params.projectId),
  pendingComponent: ProjectPending,
  errorComponent: ProjectError,
  component: ProjectLayout,
});
