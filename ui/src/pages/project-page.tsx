import { useProjectContext } from "../context/project-context";
import { MarkdownContent } from "../components/chat/markdown-content";
import { Tabs } from "../components/ui/tabs";
import { Tooltip } from "../components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import { formatTokens, formatModel, getDisplayTokenBreakdown } from "../lib/utils";
import { ProviderLogo } from "../components/chat/input-area/shared";
import type { ModelUsageStats, ProviderKind } from "@shared/types";

// ─── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  help,
}: {
  label: string;
  value: string;
  sub?: string;
  help?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border/70 bg-surface px-4 py-3">
      <span className="flex items-center gap-1 text-[0.6875rem] font-medium text-muted">
        {label}
        {help && (
          <Tooltip content={help}>
            <HelpCircle size={11} className="text-muted/40" />
          </Tooltip>
        )}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tabular-nums tracking-tight text-text-bright">
          {value}
        </span>
        {sub && <span className="text-[0.6875rem] tabular-nums text-muted">{sub}</span>}
      </div>
    </div>
  );
}

// ─── Model Bar ──────────────────────────────────────────────────────────────

const MODEL_COLORS = [
  "bg-accent",
  "bg-claude",
  "bg-[#60a5fa]",
  "bg-warning",
  "bg-error",
  "bg-[#f472b6]",
  "bg-[#a3e635]",
  "bg-[#38bdf8]",
];

function ModelUsageBreakdown({ models }: { models: ModelUsageStats[] }) {
  if (models.length === 0) return null;

  const rows = [...models]
    .map((model) => ({ model, display: getDisplayTokenBreakdown(model) }))
    .sort((a, b) => b.display.totalTokens - a.display.totalTokens);
  const totalTokens = rows.reduce((sum, row) => sum + row.display.totalTokens, 0);

  return (
    <div className="rounded-lg border border-border/70 bg-surface">
      {/* Stacked bar */}
      <div className="flex h-2 overflow-hidden rounded-t-lg">
        {rows.map(({ model: m, display }, i) => {
          const pct = totalTokens > 0 ? (display.totalTokens / totalTokens) * 100 : 0;
          return (
            <Tooltip
              key={`${m.providerName}-${m.model}`}
              content={`${formatModel(m.model)} — ${formatTokens(display.totalTokens)} (${pct.toFixed(0)}%)`}
            >
              <div
                className={`${MODEL_COLORS[i % MODEL_COLORS.length]} opacity-70 transition-opacity hover:opacity-100`}
                style={{ width: `${Math.max(pct, 1)}%` }}
              />
            </Tooltip>
          );
        })}
      </div>

      {/* Model rows */}
      <div className="divide-y divide-border/50">
        {rows.map(({ model: m, display }) => {
          const pct = totalTokens > 0 ? (display.totalTokens / totalTokens) * 100 : 0;
          return (
            <div
              key={`${m.providerName}-${m.model}`}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <ProviderLogo
                provider={m.providerName as ProviderKind}
                className="h-3.5 w-3.5 shrink-0"
                muted
              />
              <div className="min-w-0 flex-1">
                <Tooltip content={m.model}>
                  <span className="text-[0.8125rem] font-medium text-text">
                    {formatModel(m.model)}
                  </span>
                </Tooltip>
              </div>
              <div className="flex items-center gap-4 text-[0.75rem] tabular-nums">
                <Tooltip
                  content={
                    <div className="flex flex-col gap-0.5">
                      <div>Input: {formatTokens(display.inputTokens)}</div>
                      {display.cacheTokens > 0 && (
                        <div>Cache: {formatTokens(display.cacheTokens)}</div>
                      )}
                      <div>Output: {formatTokens(m.outputTokens)}</div>
                    </div>
                  }
                >
                  <span className="text-text">{formatTokens(display.totalTokens)}</span>
                </Tooltip>
                <span className="w-7 text-right text-[0.6875rem] text-muted">
                  {pct.toFixed(0)}%
                </span>
                <span className="text-muted/60">
                  {m.sessionCount} session{m.sessionCount !== 1 ? "s" : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Doc Section ────────────────────────────────────────────────────────────

interface DocTab {
  key: string;
  label: string;
  description: string;
  content: string;
}

function DocSection({ tabs }: { tabs: DocTab[] }) {
  if (tabs.length === 0) return null;

  return (
    <div>
      <h3 className="mb-2 text-[0.8125rem] font-semibold text-text-bright">Documentation</h3>
      <div className="rounded-lg border border-border/70 bg-surface">
        {tabs.length === 1 ? (
          <div className="px-4 py-3 text-[0.75rem]">
            <MarkdownContent text={tabs[0].content} />
          </div>
        ) : (
          <Tabs.Root defaultValue={tabs[0].key}>
            <div className="border-b border-border p-2">
              <Tabs.List className="inline-flex">
                {tabs.map((tab) => (
                  <Tabs.Tab key={tab.key} value={tab.key}>
                    {tab.label}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </div>
            {tabs.map((tab) => (
              <Tabs.Panel key={tab.key} value={tab.key}>
                <div className="px-4 py-3 text-[0.75rem]">
                  <MarkdownContent text={tab.content} />
                </div>
              </Tabs.Panel>
            ))}
          </Tabs.Root>
        )}
      </div>
    </div>
  );
}

// ─── Main Content ───────────────────────────────────────────────────────────

export function ProjectPage() {
  const { artifacts } = useProjectContext();

  // Build doc tabs
  const docTabs: DocTab[] = [];
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
  const normalizedUsage = modelUsage.map(getDisplayTokenBreakdown);
  const totalInput = normalizedUsage.reduce((s, r) => s + r.inputTokens, 0);
  const totalOutput = normalizedUsage.reduce((s, r) => s + r.outputTokens, 0);
  const totalCache = normalizedUsage.reduce((s, r) => s + r.cacheTokens, 0);
  const hasContent = docTabs.length > 0 || modelUsage.length > 0;

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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">
        {/* Stats row */}
        {modelUsage.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Sessions"
              value={String(artifacts.stats.sessionCount)}
              help="Total chat sessions in this project"
            />
            <StatCard
              label="Input"
              value={formatTokens(totalInput)}
              help="Tokens sent to the model — your prompts, file contents, and tool results"
            />
            <StatCard
              label="Output"
              value={formatTokens(totalOutput)}
              help="Tokens generated by the model — responses, code, and tool calls"
            />
            <StatCard
              label="Cache"
              value={formatTokens(totalCache)}
              help="Tokens served from prompt cache instead of being reprocessed — reduces latency and cost"
            />
          </div>
        )}

        {/* Model usage breakdown */}
        {modelUsage.length > 0 && <ModelUsageBreakdown models={modelUsage} />}

        {/* Documentation */}
        <DocSection tabs={docTabs} />
      </div>
    </div>
  );
}
