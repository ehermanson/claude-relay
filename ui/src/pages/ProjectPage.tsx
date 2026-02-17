import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { Group, Panel } from "react-resizable-panels";
import { Sidebar } from "../components/layout/Sidebar";
import { ResizableHandle } from "../components/ui/ResizableHandle";
import { MarkdownContent } from "../components/chat/MarkdownContent";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { fetchProjectArtifacts } from "../lib/api";
import type { ProjectArtifacts, ProjectPlan } from "@shared/types";

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Back"
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

function PlanCard({ plan }: { plan: ProjectPlan }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-hover"
      >
        <svg
          className={`h-3 w-3 shrink-0 text-muted transition-transform ${expanded ? "rotate-90" : ""}`}
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
        <span className="shrink-0 text-[0.6875rem] text-muted">{formatDate(plan.modifiedAt)}</span>
      </button>
      {expanded && (
        <div className="border-t border-border px-3.5 py-3 text-[0.8125rem]">
          <MarkdownContent text={plan.content} />
        </div>
      )}
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
  const [activeKey, setActiveKey] = useState(tabs[0].key);
  const active = tabs.find((t) => t.key === activeKey) || tabs[0];

  return (
    <div>
      {/* Tab bar */}
      <div className="mb-3 flex items-center gap-0.5 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveKey(tab.key)}
            className={`px-3 py-1.5 text-[0.75rem] font-medium transition-colors ${
              tab.key === active.key
                ? "border-b-2 border-accent text-accent"
                : "text-muted hover:text-text"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {/* Description */}
      <p className="mb-3 text-[0.6875rem] text-muted">{active.description}</p>
      {/* Content */}
      <MarkdownCard content={active.content} />
    </div>
  );
}

// ─── Main Content ───────────────────────────────────────────────────────────

function ProjectContent() {
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
  const docTabs = useMemo(() => {
    if (!artifacts) return [];
    const tabs: DocTab[] = [];
    if (artifacts.memory) {
      tabs.push({
        key: "memory",
        label: "Memory",
        description: "Persistent notes Claude remembers across sessions.",
        content: artifacts.memory,
      });
    }
    if (artifacts.claudeMd) {
      tabs.push({
        key: "claude-md",
        label: "CLAUDE.md",
        description: "Project instructions checked into the codebase.",
        content: artifacts.claudeMd,
      });
    }
    if (artifacts.readmeMd) {
      tabs.push({
        key: "readme",
        label: "README",
        description: "Project overview from the repository.",
        content: artifacts.readmeMd,
      });
    }
    return tabs;
  }, [artifacts]);

  const dirName = artifacts?.directory.split("/").pop() || projectId;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          className="animate-spin text-muted"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeDasharray="50 20"
            strokeLinecap="round"
          />
        </svg>
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
  const hasContent = hasDocs || hasPlans;

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
                      <PlanCard key={plan.slug} plan={plan} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ProjectPage() {
  const isMobile = useMediaQuery("(max-width: 768px)");

  if (isMobile) {
    return (
      <main className="flex h-full min-w-0 flex-col overflow-hidden bg-bg">
        <ProjectContent />
      </main>
    );
  }

  return (
    <Group orientation="horizontal" className="h-full">
      <Panel defaultSize="25" minSize="12" maxSize="40" collapsible collapsedSize="0">
        <Sidebar />
      </Panel>
      <ResizableHandle />
      <Panel defaultSize="75" minSize="40">
        <main className="flex h-full min-w-0 flex-col overflow-hidden bg-bg">
          <ProjectContent />
        </main>
      </Panel>
    </Group>
  );
}
