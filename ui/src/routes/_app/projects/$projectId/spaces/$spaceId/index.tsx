import { lazy, useState, useEffect, useMemo, useRef, Suspense } from "react";
import { createFileRoute, useNavigate, useParams, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  FileCode2,
  FileText,
  GitBranch,
  GitMerge,
  Info,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Group, Panel } from "react-resizable-panels";
import { useWSState, useWSMethods } from "@/context/websocket-context";
import { InstanceView } from "@/components/chat/instance-view";
import { ResizableHandle } from "@/components/ui/resizable-handle";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { fetchSpaceDetail, fetchSpaceDiff, completeSpace, deleteSpace } from "@/lib/api";
import { formatTimeAgo, formatTokens } from "@/lib/utils";
import { FilesPanel } from "@/components/chat/files-panel";
import { ConfirmMergeDialog } from "@/components/spaces/confirm-merge-dialog";
const DiffDrawer = lazy(() =>
  import("@/components/chat/diff-drawer").then((m) => ({ default: m.DiffDrawer })),
);
import type { SpaceInfo, InstanceInfo, SessionStats, FileChange } from "@shared/types";

// =============================================================================
// Space view — owns the full viewport below the sidebar
// =============================================================================

type SidebarTab = "files" | "context";

export function SpaceView() {
  const { projectId, spaceId, chatId } = useParams({ strict: false }) as {
    projectId: string;
    spaceId: string;
    chatId?: string;
  };
  const { instances } = useWSState();
  const { send } = useWSMethods();
  const navigate = useNavigate();
  const [space, setSpace] = useState<SpaceInfo | null>(null);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
  const [showSidebar, setShowSidebar] = useState(true);
  const [spaceDiff, setSpaceDiff] = useState<string | null>(null);
  const [diffInitialLoad, setDiffInitialLoad] = useState(true);
  const [showDiffDrawer, setShowDiffDrawer] = useState(false);
  const [diffScrollToFile, setDiffScrollToFile] = useState<string | undefined>();

  // Merge dialog state
  const [mergeDialog, setMergeDialog] = useState<
    | { phase: "confirm" }
    | { phase: "merging" }
    | { phase: "success"; targetBranch: string; mergeCommit?: string }
    | { phase: "error"; message: string }
    | null
  >(null);

  // Fetch space details
  useEffect(() => {
    fetchSpaceDetail(spaceId)
      .then(setSpace)
      .catch(() => {});
  }, [spaceId]);

  // Filter instances belonging to this space
  const spaceInstances = instances.filter((i) => i.spaceId === spaceId);

  const hasActiveChats = spaceInstances.some(
    (i) => i.status === "idle" || i.status === "processing",
  );

  // Fetch space diff on mount + poll every 5s while chats are active
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchSpaceDiff(spaceId)
        .then((d) => {
          if (!cancelled) setSpaceDiff(d);
        })
        .catch(() => {
          if (!cancelled) setSpaceDiff("");
        })
        .finally(() => {
          if (!cancelled) setDiffInitialLoad(false);
        });
    };
    load();
    const interval = hasActiveChats ? setInterval(load, 5_000) : undefined;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [spaceId, hasActiveChats]);

  // The active tab is driven by the URL chatId param
  const activeTab = chatId && spaceInstances.find((i) => i.id === chatId) ? chatId : null;

  // Auto-redirect to first chat when landing on space without a valid chatId
  useEffect(() => {
    if (spaceInstances.length > 0 && !activeTab) {
      navigate({
        to: "/projects/$projectId/spaces/$spaceId/$chatId",
        params: { projectId, spaceId, chatId: spaceInstances[0].id },
        replace: true,
      });
    }
  }, [spaceInstances, activeTab, navigate, projectId, spaceId]);

  const navigateToChat = (id: string) => {
    navigate({
      to: "/projects/$projectId/spaces/$spaceId/$chatId",
      params: { projectId, spaceId, chatId: id },
    });
  };

  // Aggregate stats across all space chats
  const aggregatedStats = useMemo((): SessionStats | null => {
    let hasAny = false;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    for (const inst of spaceInstances) {
      if (inst.stats) {
        hasAny = true;
        inputTokens += inst.stats.inputTokens;
        outputTokens += inst.stats.outputTokens;
        cacheCreationTokens += inst.stats.cacheCreationTokens;
        cacheReadTokens += inst.stats.cacheReadTokens;
      }
    }
    if (!hasAny) return null;
    return { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens };
  }, [spaceInstances]);

  // Track instance IDs to detect newly created chats and navigate to them
  const prevSpaceInstanceIds = useRef(new Set<string>());
  const pendingNewChat = useRef(false);
  useEffect(() => {
    const currentIds = new Set(spaceInstances.map((i) => i.id));
    if (pendingNewChat.current && prevSpaceInstanceIds.current.size > 0) {
      for (const inst of spaceInstances) {
        if (!prevSpaceInstanceIds.current.has(inst.id)) {
          pendingNewChat.current = false;
          navigateToChat(inst.id);
          break;
        }
      }
    }
    prevSpaceInstanceIds.current = currentIds;
  }, [spaceInstances]);

  const handleNewChat = () => {
    pendingNewChat.current = true;
    send({
      type: "create_instance",
      spaceId,
    });
  };

  const handleCloseTab = (id: string) => {
    const inst = spaceInstances.find((i) => i.id === id);
    const name = inst?.name || "this chat";
    if (!confirm(`Remove "${name}" from this space?`)) return;
    send({ type: "remove_instance", instanceId: id });
    if (activeTab === id) {
      const remaining = spaceInstances.filter((i) => i.id !== id);
      if (remaining.length > 0) {
        navigateToChat(remaining[0].id);
      } else {
        navigate({
          to: "/projects/$projectId/spaces/$spaceId",
          params: { projectId, spaceId },
        });
      }
    }
  };

  const handleComplete = async () => {
    setMergeDialog({ phase: "merging" });
    try {
      const result = await completeSpace(spaceId);
      setMergeDialog({
        phase: "success",
        targetBranch: result.targetBranch,
        mergeCommit: result.mergeCommit,
      });
    } catch (err) {
      setMergeDialog({
        phase: "error",
        message: err instanceof Error ? err.message : "Merge failed",
      });
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete space "${space?.name}"? This will remove the worktree without merging.`))
      return;
    try {
      await deleteSpace(spaceId);
      navigate({ to: "/projects/$projectId", params: { projectId } });
    } catch {
      // error handled by API
    }
  };

  if (!space) {
    return (
      <div className="flex h-full items-center justify-center text-muted">Loading space...</div>
    );
  }

  const activeInstance = spaceInstances.find((i) => i.id === activeTab);

  const chatTabs = (
    <div className="flex shrink-0 items-center border-b border-border bg-surface pl-1">
      {spaceInstances.map((inst) => (
        <div
          key={inst.id}
          role="tab"
          tabIndex={0}
          onClick={() => navigateToChat(inst.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigateToChat(inst.id);
          }}
          className={`group/tab relative flex cursor-pointer items-center gap-1.5 border-r border-border px-3 py-2 text-[0.8125rem] transition-colors ${
            activeTab === inst.id
              ? "bg-background text-accent"
              : "text-muted hover:bg-surface-hover hover:text-text"
          }`}
        >
          <StatusDot status={inst.status} />
          <span className="max-w-[140px] truncate font-medium">{inst.name}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCloseTab(inst.id);
            }}
            className="ml-1 flex h-4 w-4 items-center justify-center rounded opacity-0 transition-opacity group-hover/tab:opacity-100 hover:bg-surface-hover"
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        </div>
      ))}
      <button
        onClick={handleNewChat}
        className="flex h-full items-center px-2.5 py-2 text-muted transition-colors hover:bg-surface-hover hover:text-accent"
      >
        <Plus size={13} strokeWidth={2.5} />
      </button>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ── Space header ── replaces project header entirely */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        {/* Back + name */}
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          className="text-[0.8125rem] font-medium text-muted transition-colors hover:text-text"
        >
          {projectId}
        </Link>
        <ChevronLeft size={12} strokeWidth={2.5} className="shrink-0 rotate-180 text-muted/40" />
        <GitBranch size={14} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-text-bright">{space.name}</span>
          {space.gitBranch && (
            <span className="ml-2 rounded-full bg-surface-hover px-2 py-0.5 text-[0.6875rem] font-medium text-muted">
              {space.gitBranch}
            </span>
          )}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1">
          <Tooltip content="View diff">
            <button
              onClick={() => {
                setDiffScrollToFile(undefined);
                setShowDiffDrawer(true);
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              <FileCode2 size={14} />
            </button>
          </Tooltip>
          <Tooltip content="Toggle sidebar">
            <button
              onClick={() => setShowSidebar((v) => !v)}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                showSidebar
                  ? "bg-accent-dim text-accent"
                  : "text-muted hover:bg-surface-hover hover:text-text"
              }`}
            >
              <Info size={14} />
            </button>
          </Tooltip>
          <Tooltip content="Complete & merge">
            <button
              onClick={() => setMergeDialog({ phase: "confirm" })}
              className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[0.75rem] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              <GitMerge size={13} />
              Complete
            </button>
          </Tooltip>
          <Tooltip content="Delete space">
            <button
              onClick={handleDelete}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-error"
            >
              <Trash2 size={13} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* ── Main content: tabs + chat | sidebar ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {activeTab ? (
          showSidebar ? (
            <Group orientation="horizontal" className="flex-1">
              <Panel defaultSize="70" minSize="40">
                <div className="flex h-full flex-col">
                  {chatTabs}
                  <InstanceView key={activeTab} instanceId={activeTab} compact />
                </div>
              </Panel>
              <ResizableHandle />
              <Panel defaultSize="30" minSize="15" maxSize="45">
                <SpaceSidebar
                  space={space}
                  instances={spaceInstances}
                  activeTab={sidebarTab}
                  onChangeTab={setSidebarTab}
                  stats={aggregatedStats}
                  diff={spaceDiff}
                  diffLoading={diffInitialLoad}
                  onOpenDiff={(scrollTo) => {
                    setDiffScrollToFile(scrollTo);
                    setShowDiffDrawer(true);
                  }}
                />
              </Panel>
            </Group>
          ) : (
            <div className="flex h-full flex-col">
              {chatTabs}
              <InstanceView key={activeTab} instanceId={activeTab} compact />
            </div>
          )
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <GitBranch size={32} className="text-muted/30" />
            <p className="text-sm text-muted">No chats in this space yet</p>
            <Button variant="primary" size="sm" onClick={handleNewChat} className="gap-1.5">
              <Plus size={14} />
              New Chat
            </Button>
          </div>
        )}
      </div>

      {/* Full diff drawer */}
      {showDiffDrawer && spaceDiff != null && (
        <Suspense fallback={null}>
          <DiffDrawer
            rawDiff={spaceDiff}
            onClose={() => setShowDiffDrawer(false)}
            scrollToFile={diffScrollToFile}
          />
        </Suspense>
      )}

      {/* Merge confirmation */}
      <ConfirmMergeDialog
        open={mergeDialog?.phase === "confirm"}
        spaceName={space?.name}
        onConfirm={handleComplete}
        onCancel={() => setMergeDialog(null)}
      />

      {/* Merge progress / result dialog */}
      <Dialog.Root
        open={mergeDialog !== null && mergeDialog.phase !== "confirm"}
        onOpenChange={(open) => {
          if (!open && mergeDialog?.phase !== "merging") {
            if (mergeDialog?.phase === "success") {
              navigate({ to: "/projects/$projectId", params: { projectId } });
            }
            setMergeDialog(null);
          }
        }}
      >
        <Dialog.Content maxWidth="max-w-md">
          {mergeDialog?.phase === "merging" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Spinner size={18} />
              <p className="text-sm text-muted">Merging space into default branch...</p>
            </div>
          )}
          {mergeDialog?.phase === "success" && (
            <>
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10">
                  <Check size={20} className="text-accent" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-text-bright">
                    Space merged successfully
                  </p>
                  <p className="mt-1 text-[0.8125rem] text-muted">
                    Merged into{" "}
                    <span className="font-medium text-text">{mergeDialog.targetBranch}</span>
                  </p>
                  {mergeDialog.mergeCommit && (
                    <p className="mt-0.5 font-mono text-[0.75rem] text-muted/60">
                      {mergeDialog.mergeCommit.slice(0, 8)}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex justify-center pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setMergeDialog(null);
                    navigate({ to: "/projects/$projectId", params: { projectId } });
                  }}
                >
                  Done
                </Button>
              </div>
            </>
          )}
          {mergeDialog?.phase === "error" && (
            <>
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-error/10">
                  <AlertTriangle size={20} className="text-error" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-text-bright">Merge failed</p>
                  <p className="mt-1 whitespace-pre-wrap text-left text-[0.8125rem] text-muted">
                    {mergeDialog.message}
                  </p>
                </div>
              </div>
              <div className="flex justify-center pt-1">
                <Button variant="ghost" size="sm" onClick={() => setMergeDialog(null)}>
                  Close
                </Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}

// =============================================================================
// Sidebar — right panel with Files & Context tabs
// =============================================================================

function SpaceSidebar({
  space,
  instances,
  activeTab,
  onChangeTab,
  stats,
  diff,
  diffLoading,
  onOpenDiff,
}: {
  space: SpaceInfo;
  instances: InstanceInfo[];
  activeTab: SidebarTab;
  onChangeTab: (tab: SidebarTab) => void;
  stats: SessionStats | null;
  diff: string | null;
  diffLoading: boolean;
  onOpenDiff: (scrollToFile?: string) => void;
}) {
  // Parse diff to extract per-file stats as FileChange[]
  const fileChanges = useMemo((): FileChange[] => {
    if (!diff) return [];
    const files: FileChange[] = [];
    const chunks = diff.split(/^diff --git /m).filter(Boolean);
    for (const chunk of chunks) {
      const pathMatch = chunk.match(/^a\/(.+?) b\//);
      if (!pathMatch) continue;
      let additions = 0;
      let deletions = 0;
      for (const line of chunk.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        if (line.startsWith("-") && !line.startsWith("---")) deletions++;
      }
      const isNew = chunk.includes("new file mode");
      files.push({
        path: pathMatch[1],
        editCount: 1,
        type: isNew ? "added" : "edited",
        additions,
        deletions,
      });
    }
    return files;
  }, [diff]);

  const activeCount = instances.filter(
    (i) => i.status === "idle" || i.status === "processing",
  ).length;
  const stoppedCount = instances.filter((i) => i.status === "stopped").length;

  return (
    <div className="flex h-full flex-col border-l border-border bg-surface">
      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-border">
        <TabButton
          active={activeTab === "files"}
          onClick={() => onChangeTab("files")}
          icon={<FileText size={13} />}
          label="Files"
          badge={fileChanges.length > 0 ? fileChanges.length : undefined}
        />
        <TabButton
          active={activeTab === "context"}
          onClick={() => onChangeTab("context")}
          icon={<Info size={13} />}
          label="Context"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "files" &&
          (diffLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted">
              Loading changes...
            </div>
          ) : fileChanges.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted">
              No file changes yet
            </div>
          ) : (
            <FilesPanel
              files={fileChanges}
              cwd=""
              onViewChanges={() => onOpenDiff()}
              onFileClick={(path) => onOpenDiff(path)}
            />
          ))}
        {activeTab === "context" && (
          <ContextTab
            space={space}
            instances={instances}
            stats={stats}
            activeCount={activeCount}
            stoppedCount={stoppedCount}
          />
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Sidebar tab button
// =============================================================================

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-[0.75rem] font-medium transition-colors ${
        active
          ? "border-b-2 border-accent text-accent"
          : "border-b-2 border-transparent text-muted hover:text-text"
      }`}
    >
      {icon}
      {label}
      {badge !== undefined && (
        <span className="ml-0.5 rounded-full bg-accent-dim px-1.5 py-px text-[0.625rem] font-semibold text-accent">
          {badge}
        </span>
      )}
    </button>
  );
}

// =============================================================================
// Context tab — aggregated stats, chat list, space metadata
// =============================================================================

function ContextTab({
  space,
  instances,
  stats,
  activeCount,
  stoppedCount,
}: {
  space: SpaceInfo;
  instances: InstanceInfo[];
  stats: SessionStats | null;
  activeCount: number;
  stoppedCount: number;
}) {
  return (
    <div className="flex flex-col gap-4 p-3.5">
      {/* Space metadata */}
      <Section title="Space">
        <Row label="Name" value={space.name} />
        {space.gitBranch && <Row label="Branch" value={space.gitBranch} />}
        {space.worktreePath && <Row label="Worktree" value={space.worktreePath} truncate />}
        <Row label="Created" value={formatTimeAgo(space.createdAt)} />
        <Row label="Status" value={space.status} />
      </Section>

      {/* Chat summary */}
      <Section title="Chats">
        <Row label="Total" value={String(instances.length)} />
        {activeCount > 0 && <Row label="Active" value={String(activeCount)} />}
        {stoppedCount > 0 && <Row label="Ended" value={String(stoppedCount)} />}
      </Section>

      {/* Aggregated tokens */}
      {stats && (
        <Section title="Tokens">
          <Row label="Input" value={formatTokens(stats.inputTokens)} />
          <Row label="Output" value={formatTokens(stats.outputTokens)} />
          {stats.cacheCreationTokens > 0 && (
            <Row label="Cache write" value={formatTokens(stats.cacheCreationTokens)} />
          )}
          {stats.cacheReadTokens > 0 && (
            <Row label="Cache read" value={formatTokens(stats.cacheReadTokens)} />
          )}
          <Row label="Total" value={formatTokens(stats.inputTokens + stats.outputTokens)} bold />
        </Section>
      )}

      {/* Per-chat breakdown */}
      {instances.length > 0 && (
        <Section title="Per-chat">
          {instances.map((inst) => (
            <div key={inst.id} className="flex items-center gap-2 py-1">
              <StatusDot status={inst.status} />
              <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-text">
                {inst.name}
              </span>
              {inst.stats && (
                <span className="shrink-0 text-[0.6875rem] text-muted/50">
                  {formatTokens(inst.stats.inputTokens + inst.stats.outputTokens)}
                </span>
              )}
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

// =============================================================================
// Shared primitives
// =============================================================================

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-[0.6875rem] font-semibold tracking-wide text-muted/60 uppercase">
        {title}
      </h3>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  truncate,
  bold,
}: {
  label: string;
  value: string;
  truncate?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[0.8125rem]">
      <span className="shrink-0 text-muted">{label}</span>
      <span
        className={`min-w-0 text-right ${truncate ? "truncate" : ""} ${bold ? "font-semibold text-text-bright" : "text-text"}`}
      >
        {value}
      </span>
    </div>
  );
}

function StatusDot({ status }: { status: InstanceInfo["status"] }) {
  let dotClass = "bg-muted";
  if (status === "processing") dotClass = "animate-pulse-dot bg-warning";
  else if (status === "error") dotClass = "bg-error";
  else if (status === "idle") dotClass = "bg-accent";
  return <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${dotClass}`} />;
}

export const Route = createFileRoute("/_app/projects/$projectId/spaces/$spaceId/")({
  component: SpaceView,
});
