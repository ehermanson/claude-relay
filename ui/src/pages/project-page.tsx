import { useProjectContext } from "../context/project-context";
import { MarkdownContent } from "../components/chat/markdown-content";
import { Tabs } from "../components/ui/tabs";

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

  if (!hasDocs) {
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
      <div className="mx-auto max-w-6xl px-6 py-6">
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
      </div>
    </div>
  );
}
