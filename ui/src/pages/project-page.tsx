import { useProjectContext } from "../context/project-context";
import { MarkdownContent } from "../components/chat/markdown-content";
import { Tabs } from "../components/ui/tabs";
import type { McpServerConfig } from "@shared/types";

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
  const { artifacts } = useProjectContext();

  // Build doc tabs — priority order: Memory > CLAUDE.md > README.md
  const docTabs: DocTab[] = [];
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

  const hasDocs = docTabs.length > 0;
  const hasMcpServers =
    artifacts.mcpServers !== null && Object.keys(artifacts.mcpServers).length > 0;
  const hasContent = hasDocs || hasMcpServers;

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

  const integrationsSection = hasMcpServers && artifacts.mcpServers && (
    <div>
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
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex flex-col gap-6 md:flex-row">
          {/* Docs — 2/3 */}
          {hasDocs && (
            <div className={`min-w-0 ${hasMcpServers ? "md:w-2/3" : "flex-1"}`}>
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

          {/* Integrations — 1/3 */}
          {hasMcpServers && (
            <div className={`${hasDocs ? "md:w-1/3" : "flex-1"}`}>{integrationsSection}</div>
          )}
        </div>
      </div>
    </div>
  );
}
