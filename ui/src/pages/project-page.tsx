import { useProjectContext } from "../context/project-context";
import { MarkdownContent } from "../components/chat/markdown-content";
import { Tabs } from "../components/ui/tabs";
import { Tooltip } from "../components/ui/tooltip";
import { formatTokens, formatModel, getDisplayTokenBreakdown } from "../lib/utils";
import type { ModelUsageStats } from "@shared/types";

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

// ─── Model Usage ─────────────────────────────────────────────────────────────

function ModelUsageTable({ models }: { models: ModelUsageStats[] }) {
  if (models.length === 0) return null;

  const rows = [...models]
    .map((model) => ({ model, display: getDisplayTokenBreakdown(model) }))
    .sort((a, b) => b.display.totalTokens - a.display.totalTokens);
  const totalTokens = rows.reduce((sum, row) => sum + row.display.totalTokens, 0);

  return (
    <div className="rounded-lg border border-border bg-surface">
      <table className="w-full text-[0.75rem]">
        <thead>
          <tr className="border-b border-border text-left text-[0.6875rem] text-muted">
            <th className="px-3.5 py-2 font-medium">Model</th>
            <th className="px-3.5 py-2 text-right font-medium">Sessions</th>
            <th className="px-3.5 py-2 text-right font-medium">Input</th>
            <th className="px-3.5 py-2 text-right font-medium">Cache</th>
            <th className="px-3.5 py-2 text-right font-medium">Output</th>
            <th className="px-3.5 py-2 text-right font-medium">Total</th>
            <th className="w-24 px-3.5 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ model: m, display }) => {
            const pct = totalTokens > 0 ? (display.totalTokens / totalTokens) * 100 : 0;
            return (
              <tr
                key={`${m.providerName}-${m.model}`}
                className="border-b border-border/50 last:border-0"
              >
                <td className="px-3.5 py-2">
                  <Tooltip content={m.model}>
                    <span className="font-medium text-text">{formatModel(m.model)}</span>
                  </Tooltip>
                  <span className="ml-1.5 text-[0.625rem] text-muted">{m.providerName}</span>
                </td>
                <td className="px-3.5 py-2 text-right tabular-nums text-muted">{m.sessionCount}</td>
                <td className="px-3.5 py-2 text-right tabular-nums text-muted">
                  {formatTokens(display.inputTokens)}
                </td>
                <td className="px-3.5 py-2 text-right tabular-nums text-muted">
                  {display.cacheTokens > 0 ? (
                    <Tooltip
                      content={
                        <div className="flex flex-col gap-0.5">
                          {m.cacheCreationTokens > 0 && (
                            <div>Cache write: {formatTokens(m.cacheCreationTokens)}</div>
                          )}
                          {m.cacheReadTokens > 0 && (
                            <div>
                              {m.providerName === "codex" ? "Cached input" : "Cache read"}:{" "}
                              {formatTokens(m.cacheReadTokens)}
                            </div>
                          )}
                        </div>
                      }
                    >
                      <span>{formatTokens(display.cacheTokens)}</span>
                    </Tooltip>
                  ) : (
                    formatTokens(0)
                  )}
                </td>
                <td className="px-3.5 py-2 text-right tabular-nums text-muted">
                  {formatTokens(m.outputTokens)}
                </td>
                <td className="px-3.5 py-2 text-right tabular-nums text-text">
                  {formatTokens(display.totalTokens)}
                </td>
                <td className="px-3.5 py-2">
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-hover">
                      <div
                        className="h-full rounded-full bg-accent/60"
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-[0.625rem] tabular-nums text-muted">
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Content ───────────────────────────────────────────────────────────

export function ProjectPage() {
  const { artifacts } = useProjectContext();

  // Build doc tabs — priority order: Memory > CLAUDE.md > README.md
  const docTabs: DocTab[] = [];
  if (artifacts.memory) {
    docTabs.push({
      key: "memory",
      label: "Memory",
      description: "Persistent notes Claude remembers across chats.",
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

  const modelUsage = artifacts.stats.modelUsage ?? [];
  const hasDocs = docTabs.length > 0;
  const hasContent = hasDocs || modelUsage.length > 0;

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

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="mb-1 text-sm text-muted">No artifacts found for this project</p>
        <span className="text-xs text-muted opacity-60">
          Memory, instructions, and plans will appear here
        </span>
      </div>
    );
  }

  const statsIcon = (
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
      <path d="M18 20V10" />
      <path d="M12 20V4" />
      <path d="M6 20v-6" />
    </svg>
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        {hasDocs && (
          <div className="min-w-0 flex-1">
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

        {modelUsage.length > 0 && (
          <div>
            <SectionHeading
              title="Model Usage"
              description="Token usage by model across all sessions."
              icon={statsIcon}
            />
            <ModelUsageTable models={modelUsage} />
          </div>
        )}
      </div>
    </div>
  );
}
