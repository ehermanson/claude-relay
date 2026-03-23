import {
  createFileRoute,
  Outlet,
  useParams,
  useLocation,
  Link,
  redirect,
} from "@tanstack/react-router";
import { motion } from "motion/react";
import { ChevronLeft } from "lucide-react";
import { GitStatusBar } from "@/components/project/git-status-bar";
import { OpenInMenu } from "@/components/project/open-in-menu";
import { RelayLogo } from "@/components/ui/relay-logo";
import { Tooltip } from "@/components/ui/tooltip";
import { ProjectContext } from "@/context/project-context";
import { useWSState } from "@/context/websocket-context";
import { useMediaQuery } from "@/hooks/use-media-query";
import { ApiError, fetchProjectArtifacts } from "@/lib/api";
import { getProjectName, instanceMatchesProject } from "@/lib/project-route";
import { formatTokens, getDisplayTokenBreakdown } from "@/lib/utils";

const MotionLogo = motion.create(RelayLogo);

function BackButton({ to }: { to: string }) {
  return (
    <Tooltip content="Back">
      <Link
        to={to}
        className="hidden h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text max-[768px]:flex"
      >
        <ChevronLeft size={16} />
      </Link>
    </Tooltip>
  );
}

function NavTab({
  to,
  params,
  active,
  label,
  count,
  badge,
}: {
  to: string;
  params: Record<string, string>;
  active: boolean;
  label: string;
  count?: number;
  badge?: string;
}) {
  return (
    <Link
      to={to}
      params={params}
      className={`relative flex items-center gap-1.5 px-3 py-2.5 text-[0.8125rem] font-medium transition-colors ${
        active ? "text-accent" : "text-muted hover:text-text"
      }`}
    >
      {label}
      {count != null && count > 0 && (
        <span
          className={`text-[0.6875rem] font-normal tabular-nums ${active ? "text-accent/60" : "text-muted/50"}`}
        >
          {count}
        </span>
      )}
      {badge && (
        <span className="flex items-center gap-1 rounded-md bg-accent/10 px-1.5 py-px text-[0.625rem] font-medium text-accent">
          <span className="inline-block h-1 w-1 rounded-full bg-accent" />
          {badge}
        </span>
      )}
      {active && (
        <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-accent" />
      )}
    </Link>
  );
}

function ProjectLayout() {
  const { chatId, planSlug, spaceId } = useParams({ strict: false }) as {
    chatId?: string;
    planSlug?: string;
    spaceId?: string;
  };
  const location = useLocation();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { instances } = useWSState();

  const artifacts = Route.useLoaderData();
  const projectId = artifacts.projectId;
  const dirName = getProjectName(artifacts.directory);

  const isChildView = !!chatId || !!planSlug || !!spaceId;

  // Session stats
  const projectInstances = instances.filter((inst) => instanceMatchesProject(inst, projectId));
  const sessionStats = {
    total: projectInstances.length,
    activeCount: projectInstances.filter((i) => i.status === "idle" || i.status === "processing")
      .length,
  };

  // Active tab
  const pathname = location.pathname;
  const isPlansTab = pathname.includes("/plans");
  const isTasksTab = pathname.includes("/tasks");
  const isSkillsTab = pathname.includes("/skills");
  const isChatsTab = pathname.includes("/chats");
  const isSettingsTab = pathname.includes("/settings");
  const isOverviewTab = !isPlansTab && !isTasksTab && !isSkillsTab && !isChatsTab && !isSettingsTab;

  const planCount = artifacts.plans.length;
  const taskCount = artifacts.tasks?.length ?? 0;
  const skillCount = artifacts.skills.length;

  const ctxValue = { artifacts };

  if (isChildView) {
    return (
      <ProjectContext.Provider value={ctxValue}>
        <Outlet />
      </ProjectContext.Provider>
    );
  }

  const chatBadge = sessionStats.activeCount > 0 ? `${sessionStats.activeCount} active` : undefined;

  const modelUsage = artifacts.stats.modelUsage ?? [];
  const normalizedUsage = modelUsage.map(getDisplayTokenBreakdown);
  const normalizedInputTokens = normalizedUsage.reduce((sum, row) => sum + row.inputTokens, 0);
  const normalizedOutputTokens = normalizedUsage.reduce((sum, row) => sum + row.outputTokens, 0);
  const normalizedCacheTokens = normalizedUsage.reduce((sum, row) => sum + row.cacheTokens, 0);
  const normalizedTotalTokens =
    modelUsage.length > 0
      ? normalizedUsage.reduce((sum, row) => sum + row.totalTokens, 0)
      : artifacts.stats.inputTokens +
        artifacts.stats.outputTokens +
        artifacts.stats.cacheCreationTokens +
        artifacts.stats.cacheReadTokens;

  return (
    <ProjectContext.Provider value={ctxValue}>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-5 py-2.5">
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
              {normalizedTotalTokens > 0 && (
                <>
                  <span className="hidden text-border sm:inline">·</span>
                  <Tooltip
                    content={
                      <div className="flex flex-col gap-0.5">
                        <div>Input: {formatTokens(normalizedInputTokens)}</div>
                        <div>Output: {formatTokens(normalizedOutputTokens)}</div>
                        {normalizedCacheTokens > 0 && (
                          <div>Cache: {formatTokens(normalizedCacheTokens)}</div>
                        )}
                      </div>
                    }
                  >
                    <span className="shrink-0">
                      {formatTokens(normalizedTotalTokens)} tokens across{" "}
                      {artifacts.stats.sessionCount} session
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

        {/* Git status bar */}
        <GitStatusBar projectId={projectId} />

        {/* Sub-nav */}
        <nav className="flex shrink-0 items-center gap-1 border-b border-border/70 px-6">
          <NavTab
            to="/projects/$projectId"
            params={{ projectId }}
            active={isOverviewTab}
            label="Overview"
          />
          <NavTab
            to="/projects/$projectId/plans"
            params={{ projectId }}
            active={isPlansTab}
            label="Plans"
            count={planCount}
          />
          {taskCount > 0 && (
            <NavTab
              to="/projects/$projectId/tasks"
              params={{ projectId }}
              active={isTasksTab}
              label="Tasks"
              count={taskCount}
            />
          )}
          {skillCount > 0 && (
            <NavTab
              to="/projects/$projectId/skills"
              params={{ projectId }}
              active={isSkillsTab}
              label="Skills"
              count={skillCount}
            />
          )}
          <NavTab
            to="/projects/$projectId/chats"
            params={{ projectId }}
            active={isChatsTab}
            label="Chats"
            count={sessionStats.total}
            badge={chatBadge}
          />
          <NavTab
            to="/projects/$projectId/settings"
            params={{ projectId }}
            active={isSettingsTab}
            label="Settings"
          />
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
  loader: async ({ params }) => {
    try {
      return await fetchProjectArtifacts(params.projectId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw redirect({ to: "/" });
      }
      throw err;
    }
  },
  pendingComponent: ProjectPending,
  errorComponent: ProjectError,
  component: ProjectLayout,
});
