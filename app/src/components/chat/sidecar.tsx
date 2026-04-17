import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Progress } from "../ui/progress";
import { Spinner } from "../ui/spinner";
import type { ChatItem } from "@/hooks/use-instance-messages";
import type { TaskItem, FileChange, SessionStats, ProviderStatusSummary } from "@shared/types";
import { MarkdownContent } from "./markdown-content";
import { FilesPanel } from "./files-panel";
import { ContextPanel } from "./context-panel";
import { SidecarShell, type SidecarTabDef } from "./sidecar-shell";
import { MobileSidecarOverlay } from "../ui/mobile-sidecar-overlay";
import "./sidecar.css";

const DiffDrawer = lazy(() => import("./diff-drawer").then((m) => ({ default: m.DiffDrawer })));

const PlanPanel = memo(function PlanPanel({ content }: { content: string }) {
  return (
    <div className="flex-1 overflow-y-auto px-3.5 py-3 text-[0.8125rem]">
      <MarkdownContent text={content} />
    </div>
  );
});

function StatusIcon({ status }: { status: TaskItem["status"] }) {
  switch (status) {
    case "completed":
      return (
        <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded bg-accent-dim text-accent">
          <Check size={10} strokeWidth={3} />
        </div>
      );
    case "in_progress":
      return (
        <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
          <Spinner size={14} />
        </div>
      );
    case "pending":
      return (
        <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
          <div className="h-[14px] w-[14px] rounded-full border-2 border-muted/30" />
        </div>
      );
  }
}

function sameTasks(prev: TaskItem[] | null, next: TaskItem[] | null): boolean {
  const prevList = prev ?? [];
  const nextList = next ?? [];
  if (prevList.length !== nextList.length) return false;
  for (let i = 0; i < prevList.length; i++) {
    const a = prevList[i];
    const b = nextList[i];
    if (!b) return false;
    if (
      a.id !== b.id ||
      a.subject !== b.subject ||
      a.status !== b.status ||
      a.activeForm !== b.activeForm
    ) {
      return false;
    }
  }
  return true;
}

function sameFiles(prev: FileChange[] | null, next: FileChange[] | null): boolean {
  const prevList = prev ?? [];
  const nextList = next ?? [];
  if (prevList.length !== nextList.length) return false;
  for (let i = 0; i < prevList.length; i++) {
    const a = prevList[i];
    const b = nextList[i];
    if (!b) return false;
    if (
      a.path !== b.path ||
      a.editCount !== b.editCount ||
      a.type !== b.type ||
      a.additions !== b.additions ||
      a.deletions !== b.deletions
    ) {
      return false;
    }
  }
  return true;
}

const TasksPanel = memo(function TasksPanel({ tasks }: { tasks: TaskItem[] }) {
  const completed = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;
  const allDone = completed === total;

  return (
    <>
      {/* Progress bar */}
      <div className="shrink-0 px-3.5 py-2.5">
        <div className="flex items-center justify-between pb-1.5">
          <span className={`text-[0.75rem] font-medium ${allDone ? "text-accent" : "text-muted"}`}>
            {completed}/{total} done
          </span>
          {allDone && <span className="text-[0.625rem] font-medium text-accent">Complete</span>}
        </div>
        <Progress value={progress} indicatorClass={allDone ? "bg-accent" : "bg-claude"} />
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="flex flex-col gap-0.5">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem] leading-snug transition-colors hover:bg-surface-hover"
            >
              <div className="mt-px">
                <StatusIcon status={task.status} />
              </div>
              <span
                className={`min-w-0 ${
                  task.status === "completed" ? "text-muted line-through" : "text-text"
                }`}
              >
                {task.status === "in_progress" && task.activeForm ? task.activeForm : task.subject}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
});

/** Chevron icon that rotates when open. */
// ChevronIcon, DiffStats, DirGroup, groupFilesByDir, FilesPanel
// moved to ./files-panel.tsx for reuse in space sidebar

// (FilesPanel implementation in ./files-panel.tsx)

// =============================================================================
// Tab system
// =============================================================================

import type { SidecarTab } from "@/stores/sidecar-store";
export type { SidecarTab } from "@/stores/sidecar-store";
import type { ProviderGlobalState, ProviderKind } from "@shared/types";

function samePanelSets(a: ReadonlySet<SidecarTab>, b: ReadonlySet<SidecarTab>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

interface SidecarProps {
  tasks: TaskItem[] | null;
  files: FileChange[] | null;
  planContent?: string | null;
  stats?: SessionStats | null;
  items?: ChatItem[];
  provider?: ProviderKind;
  providerStatus?: ProviderStatusSummary;
  providerGlobalState?: ProviderGlobalState;
  instanceId?: string;
  createdAt?: number;
  lastActivityAt?: number;
  workingDirectory: string;
  /** Which panels are toggled on from the header. */
  activePanels: ReadonlySet<SidecarTab>;
  /** Called when mobile overlay should close. */
  onClose?: () => void;
  isMobileOverlay?: boolean;
}

export const Sidecar = memo(
  function Sidecar({
    tasks,
    files,
    planContent,
    stats,
    items,
    provider,
    providerStatus,
    providerGlobalState,
    instanceId,
    createdAt,
    lastActivityAt,
    workingDirectory,
    activePanels,
    onClose,
    isMobileOverlay,
  }: SidecarProps) {
    const hasTasks = tasks && tasks.length > 0;
    const hasFiles = files && files.length > 0;
    const hasPlan = !!planContent;
    const hasStats = !!stats && (stats.inputTokens > 0 || stats.outputTokens > 0);
    const hasProviderContext = Boolean(
      providerStatus?.threadStatus ||
      providerStatus?.turnStatus ||
      providerStatus?.effectiveModel ||
      providerStatus?.notices?.length ||
      providerGlobalState?.account ||
      providerGlobalState?.mcpServers?.length ||
      providerGlobalState?.apps?.length ||
      providerGlobalState?.notices?.length,
    );

    const [diffDrawerOpen, setDiffDrawerOpen] = useState(false);
    const [diffScrollToFile, setDiffScrollToFile] = useState<string | undefined>();

    const openDiffDrawer = (scrollTo?: string) => {
      setDiffScrollToFile(scrollTo);
      setDiffDrawerOpen(true);
    };

    // Build available tabs: must have content AND be in activePanels
    const availableTabs = useMemo<(SidecarTabDef & { key: SidecarTab })[]>(() => {
      const tabs: (SidecarTabDef & { key: SidecarTab })[] = [];
      if (hasTasks && activePanels.has("tasks"))
        tabs.push({ key: "tasks", label: "Tasks", count: tasks.length });
      if (hasFiles && activePanels.has("files"))
        tabs.push({ key: "files", label: "Files", count: files.length });
      if (hasPlan && activePanels.has("plan")) tabs.push({ key: "plan", label: "Plan" });
      if ((hasStats || hasProviderContext) && activePanels.has("context"))
        tabs.push({ key: "context", label: "Context" });
      return tabs;
    }, [activePanels, files, hasFiles, hasTasks, hasStats, hasProviderContext, tasks]);

    const [activeTab, setActiveTab] = useState<SidecarTab>("tasks");

    // Auto-switch to newly added panel when toggled on from the header
    const prevActivePanelsRef = useRef(activePanels);
    useEffect(() => {
      const prev = prevActivePanelsRef.current;
      prevActivePanelsRef.current = activePanels;
      for (const panel of activePanels) {
        if (!prev.has(panel)) {
          setActiveTab(panel);
          return;
        }
      }
    }, [activePanels]);

    // Resolve effective tab: if activeTab isn't available, fall back to first available
    const effectiveTab =
      availableTabs.find((t) => t.key === activeTab)?.key ?? availableTabs[0]?.key ?? "tasks";

    const renderTabContent = (key: string) => {
      if (key === "tasks" && hasTasks) return <TasksPanel tasks={tasks} />;
      if (key === "plan" && hasPlan) return <PlanPanel content={planContent} />;
      if (key === "files" && hasFiles)
        return (
          <FilesPanel
            files={files}
            cwd={workingDirectory}
            onViewChanges={instanceId ? () => openDiffDrawer() : undefined}
            onFileClick={instanceId ? (path) => openDiffDrawer(path) : undefined}
          />
        );
      if (key === "context" && (hasStats || hasProviderContext))
        return (
          <ContextPanel
            mode="instance"
            stats={stats ?? null}
            items={items ?? []}
            provider={provider}
            providerStatus={providerStatus}
            providerGlobalState={providerGlobalState}
            createdAt={createdAt ?? Date.now()}
            lastActivityAt={lastActivityAt ?? Date.now()}
          />
        );
      return null;
    };

    const panel = (
      <SidecarShell
        tabs={availableTabs}
        activeTab={effectiveTab}
        onActiveTabChange={(key) => setActiveTab(key as SidecarTab)}
        renderTabContent={renderTabContent}
        isMobileOverlay={isMobileOverlay}
        onClose={onClose}
      />
    );

    const diffDrawer = diffDrawerOpen && instanceId && (
      <Suspense>
        <DiffDrawer
          instanceId={instanceId}
          knownFiles={files ?? undefined}
          workingDirectory={workingDirectory}
          onClose={() => setDiffDrawerOpen(false)}
          scrollToFile={diffScrollToFile}
        />
      </Suspense>
    );

    if (isMobileOverlay) {
      return (
        <>
          <MobileSidecarOverlay onClose={onClose ?? (() => {})}>{panel}</MobileSidecarOverlay>
          {diffDrawer}
        </>
      );
    }

    return (
      <>
        {panel}
        {diffDrawer}
      </>
    );
  },
  (prev, next) => {
    return (
      samePanelSets(prev.activePanels, next.activePanels) &&
      prev.workingDirectory === next.workingDirectory &&
      prev.isMobileOverlay === next.isMobileOverlay &&
      prev.instanceId === next.instanceId &&
      prev.createdAt === next.createdAt &&
      prev.lastActivityAt === next.lastActivityAt &&
      prev.stats === next.stats &&
      prev.items === next.items &&
      prev.provider === next.provider &&
      prev.providerStatus === next.providerStatus &&
      prev.providerGlobalState === next.providerGlobalState &&
      prev.planContent === next.planContent &&
      sameTasks(prev.tasks, next.tasks) &&
      sameFiles(prev.files, next.files)
    );
  },
);
