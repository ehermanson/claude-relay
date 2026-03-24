import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Progress } from "../ui/progress";
import { Spinner } from "../ui/spinner";
import { Button } from "../ui/button";
import type { ChatItem } from "@/hooks/use-instance-messages";
import type { TaskItem, FileChange, SessionStats, HistoryEntry } from "@shared/types";
import { MarkdownContent } from "./markdown-content";
import { FilesPanel } from "./files-panel";
import { ContextPanel } from "./context-panel";
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

import type { SidecarTab } from "@/hooks/use-sidecar-panels";
export type { SidecarTab } from "@/hooks/use-sidecar-panels";

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
  rawHistory?: HistoryEntry[] | null;
  provider?: string;
  preferredModel?: string;
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
    rawHistory,
    provider,
    preferredModel,
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

    const [diffDrawerOpen, setDiffDrawerOpen] = useState(false);
    const [diffScrollToFile, setDiffScrollToFile] = useState<string | undefined>();

    const openDiffDrawer = (scrollTo?: string) => {
      setDiffScrollToFile(scrollTo);
      setDiffDrawerOpen(true);
    };

    // Build available tabs: must have content AND be in activePanels
    const availableTabs = useMemo(() => {
      const tabs: { key: SidecarTab; label: string; count: number }[] = [];
      if (hasTasks && activePanels.has("tasks"))
        tabs.push({ key: "tasks", label: "Tasks", count: tasks.length });
      if (hasFiles && activePanels.has("files"))
        tabs.push({ key: "files", label: "Files", count: files.length });
      if (hasPlan && activePanels.has("plan")) tabs.push({ key: "plan", label: "Plan", count: 0 });
      if (hasStats && activePanels.has("context"))
        tabs.push({ key: "context", label: "Context", count: 0 });
      return tabs;
    }, [activePanels, files, hasFiles, hasTasks, hasStats, tasks]);

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

    const panel = (
      <div
        className={
          isMobileOverlay
            ? "@container/sidecar animate-slide-in-right flex h-full w-[85vw] max-w-sm flex-col overflow-hidden rounded-l-2xl border-l border-border bg-surface shadow-2xl"
            : "@container/sidecar flex h-full w-full flex-col overflow-hidden border-l border-border/50 bg-surface"
        }
      >
        {/* Header */}
        <div className="shrink-0 border-b border-border/60">
          <div className="flex items-center justify-between">
            {availableTabs.length > 1 ? (
              <div className="flex min-w-0 flex-1 items-stretch">
                {availableTabs.map((tab) => {
                  const isActive = tab.key === effectiveTab;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={`relative flex min-w-0 flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-[0.8125rem] font-semibold transition-colors ${
                        isActive
                          ? "border-accent text-text-bright"
                          : "border-transparent text-muted hover:text-text"
                      }`}
                    >
                      <span className="truncate">{tab.label}</span>
                      {tab.count > 0 && (
                        <span
                          className={`shrink-0 text-[0.75rem] tabular-nums ${
                            isActive ? "text-text" : "text-muted/70"
                          }`}
                        >
                          {tab.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <h2 className="px-3.5 py-2.5 text-[0.8125rem] font-semibold text-text-bright">
                {availableTabs[0]?.label ?? "Sidecar"}
              </h2>
            )}
            {isMobileOverlay && onClose && (
              <Button variant="icon" size="icon-sm" onClick={onClose} className="mr-2 shrink-0">
                <X size={14} />
              </Button>
            )}
          </div>
        </div>

        {/* Panel content */}
        {effectiveTab === "tasks" && hasTasks && <TasksPanel tasks={tasks} />}
        {effectiveTab === "plan" && hasPlan && <PlanPanel content={planContent} />}
        {effectiveTab === "files" && hasFiles && (
          <FilesPanel
            files={files}
            cwd={workingDirectory}
            onViewChanges={instanceId ? () => openDiffDrawer() : undefined}
            onFileClick={instanceId ? (path) => openDiffDrawer(path) : undefined}
          />
        )}
        {effectiveTab === "context" && hasStats && (
          <ContextPanel
            mode="instance"
            stats={stats!}
            items={items ?? []}
            rawHistory={rawHistory ?? null}
            provider={provider}
            preferredModel={preferredModel}
            createdAt={createdAt ?? Date.now()}
            lastActivityAt={lastActivityAt ?? Date.now()}
          />
        )}
      </div>
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
          <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
            <div className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div className="relative h-full" onClick={(e) => e.stopPropagation()}>
              {panel}
            </div>
          </div>
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
      prev.rawHistory === next.rawHistory &&
      prev.preferredModel === next.preferredModel &&
      prev.planContent === next.planContent &&
      sameTasks(prev.tasks, next.tasks) &&
      sameFiles(prev.files, next.files)
    );
  },
);
