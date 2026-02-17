import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "@tanstack/react-router";
import { MarkdownContent } from "../components/chat/markdown-content";
import { useMediaQuery } from "../hooks/use-media-query";
import { Tabs } from "../components/ui/tabs";
import { Collapsible } from "../components/ui/collapsible";
import { Spinner } from "../components/ui/spinner";
import { Tooltip } from "../components/ui/tooltip";
import { fetchProjectArtifacts } from "../lib/api";
import { formatTokens, formatCost } from "../lib/utils";
import type { ProjectArtifacts, ProjectPlan, McpServerConfig } from "@shared/types";

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip content="Back">
      <button
        onClick={onClick}
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
      </button>
    </Tooltip>
  );
}

function formatDate(epoch: number): string {
  if (!epoch) return "";
  const d = new Date(epoch);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Section Heading ────────────────────────────────────────────────────────

function SectionHeading({
  title,
  description,
  icon,
}: {
  title: string;
  description?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <span className="text-muted">{icon}</span>
        <h2 className="text-[0.8125rem] font-semibold text-text-bright">{title}</h2>
      </div>
      {description && <p className="mt-0.5 pl-[22px] text-[0.6875rem] text-muted">{description}</p>}
    </div>
  );
}

// ─── Plan Card ──────────────────────────────────────────────────────────────

function PlanCard({ plan, projectId }: { plan: ProjectPlan; projectId: string }) {
  return (
    <div className="group/plan rounded-lg border border-border bg-surface">
      <Collapsible.Root>
        <Collapsible.Trigger className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-hover">
          <svg
            className="h-3 w-3 shrink-0 text-muted transition-transform data-[open]:rotate-90"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-text-bright">
            {plan.title}
          </span>
          <Tooltip content="Open full view">
            <Link
              to="/projects/$projectId/plans/$planSlug"
              params={{ projectId, planSlug: plan.slug }}
              className="shrink-0 rounded p-1 text-muted opacity-0 transition-all hover:bg-surface-hover hover:text-text group-hover/plan:opacity-100"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
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
                <path d="M15 3h6v6" />
                <path d="M10 14L21 3" />
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              </svg>
            </Link>
          </Tooltip>
          <span className="shrink-0 text-[0.6875rem] text-muted">
            {formatDate(plan.modifiedAt)}
          </span>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div className="border-t border-border px-3.5 py-3 text-[0.8125rem]">
            <MarkdownContent text={plan.content} />
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  );
}

// ─── Markdown Card ──────────────────────────────────────────────────────────

function MarkdownCard({ content }: { content: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="px-3.5 py-3 text-[0.75rem]">
        <MarkdownContent text={content} />
      </div>
    </div>
  );
}

// ─── Doc Tab ────────────────────────────────────────────────────────────────

interface DocTab {
  key: string;
  label: string;
  description: string;
  content: string;
}

function DocTabs({ tabs }: { tabs: DocTab[] }) {
  return (
    <Tabs.Root defaultValue={tabs[0].key}>
      <Tabs.List className="mb-3 inline-flex">
        {tabs.map((tab) => (
          <Tabs.Tab key={tab.key} value={tab.key}>
            {tab.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {tabs.map((tab) => (
        <Tabs.Panel key={tab.key} value={tab.key}>
          <p className="mb-3 text-[0.6875rem] text-muted">{tab.description}</p>
          <MarkdownCard content={tab.content} />
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}

// ─── MCP Server Card ─────────────────────────────────────────────────────

function McpServerCard({ name, config }: { name: string; config: McpServerConfig }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[0.8125rem] font-medium text-text-bright">{name}</span>
          <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[0.625rem] font-medium uppercase tracking-wider text-muted">
            {config.type}
          </span>
        </div>
        {config.url && <p className="mt-0.5 truncate text-[0.6875rem] text-muted">{config.url}</p>}
        {config.command && (
          <p className="mt-0.5 truncate text-[0.6875rem] font-mono text-muted">
            {config.command}
            {config.args?.length ? ` ${config.args.join(" ")}` : ""}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main Content ───────────────────────────────────────────────────────────

export function ProjectPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const navigate = useNavigate();
  const isMobile = useMediaQuery("(max-width: 768px)");

  const [artifacts, setArtifacts] = useState<ProjectArtifacts | null>(null);
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

  // Build doc tabs — priority order: Memory > CLAUDE.md > README.md
  const docTabs: DocTab[] = [];
  if (artifacts) {
    if (artifacts.memory) {
      docTabs.push({
        key: "memory",
        label: "Memory",
        description: "Persistent notes Claude remembers across sessions.",
        content: artifacts.memory,
      });
    }
    if (artifacts.claudeMd) {
      docTabs.push({
        key: "claude-md",
        label: "CLAUDE.md",
        description: "Project instructions checked into the codebase.",
        content: artifacts.claudeMd,
      });
    }
    if (artifacts.readmeMd) {
      docTabs.push({
        key: "readme",
        label: "README",
        description: "Project overview from the repository.",
        content: artifacts.readmeMd,
      });
    }
  }

  const dirName = artifacts?.directory.split("/").pop() || projectId;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size={20} className="text-muted" />
      </div>
    );
  }

  if (error || !artifacts) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
        <p className="mb-1 text-sm font-medium text-text">Project not found</p>
        <span className="text-xs text-muted">{error || "Could not load project artifacts"}</span>
      </div>
    );
  }

  const hasDocs = docTabs.length > 0;
  const hasPlans = artifacts.plans.length > 0;
  const hasMcpServers =
    artifacts.mcpServers !== null && Object.keys(artifacts.mcpServers).length > 0;
  const hasContent = hasDocs || hasPlans || hasMcpServers;

  // Single doc — render inline with heading, no tabs needed
  const singleDoc = docTabs.length === 1 ? docTabs[0] : null;
  const docIcon = (
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
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-3">
        {isMobile && <BackButton onClick={() => navigate({ to: "/chat" })} />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[0.9375rem] font-semibold tracking-tight text-text-bright">
            {dirName}
          </h1>
          <p className="truncate text-xs text-muted">{artifacts.directory}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
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
          {artifacts.stats.costUSD > 0 && (
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

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!hasContent ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="mb-1 text-sm text-muted">No artifacts found for this project</p>
            <span className="text-xs text-muted opacity-60">
              Memory, instructions, and plans will appear here
            </span>
          </div>
        ) : (
          <div className="mx-auto max-w-6xl px-6 py-6">
            <div className="flex flex-col gap-6 lg:flex-row">
              {/* Left column — Docs */}
              {hasDocs && (
                <div className={hasPlans ? "min-w-0 lg:w-[50%]" : "min-w-0 flex-1"}>
                  {singleDoc ? (
                    <>
                      <SectionHeading
                        title={singleDoc.label}
                        description={singleDoc.description}
                        icon={docIcon}
                      />
                      <MarkdownCard content={singleDoc.content} />
                    </>
                  ) : (
                    <DocTabs tabs={docTabs} />
                  )}
                </div>
              )}

              {/* Right column — Plans */}
              {hasPlans && (
                <div className={hasDocs ? "min-w-0 lg:w-[50%]" : "min-w-0 flex-1"}>
                  <SectionHeading
                    title={`Plans (${artifacts.plans.length})`}
                    description="Implementation plans generated during sessions."
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
                        <path d="M9 11l3 3L22 4" />
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                      </svg>
                    }
                  />
                  <div className="flex flex-col gap-2">
                    {artifacts.plans.map((plan) => (
                      <PlanCard key={plan.slug} plan={plan} projectId={projectId} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* MCP Servers */}
            {hasMcpServers && artifacts.mcpServers && (
              <div className="mt-6">
                <SectionHeading
                  title={`Integrations (${Object.keys(artifacts.mcpServers).length})`}
                  description="MCP servers configured for this project."
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
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                  }
                />
                <div className="flex flex-col gap-2">
                  {Object.entries(artifacts.mcpServers).map(([name, config]) => (
                    <McpServerCard key={name} name={name} config={config} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
