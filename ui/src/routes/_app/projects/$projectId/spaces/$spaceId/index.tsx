import { lazy, useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useParams, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bug,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  EllipsisVertical,
  FileCode2,
  FileText,
  FolderOpen,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Info,
  Upload,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Group, Panel } from "react-resizable-panels";
import { useWSState, useWSMethods } from "@/context/websocket-context";
import { useProjectContext } from "@/context/project-context";
import { InstanceView } from "@/components/chat/instance-view";
import { ResizableHandle } from "@/components/ui/resizable-handle";
import { Tooltip } from "@/components/ui/tooltip";
import { Menu } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  completeSpace,
  deleteSpace,
  fetchProjectChats,
  fetchSpaceDetail,
  fetchSpaceDiff,
  pushSpace,
} from "@/lib/api";
import { getProjectName } from "@/lib/project-route";
import { formatTimeAgo, formatTimestamp, formatTokens } from "@/lib/utils";
import {
  HeaderActionDivider,
  HeaderContextToggle,
  HeaderIconSkeleton,
} from "@/components/chat/header-actions";
import { FilesPanel } from "@/components/chat/files-panel";
import { OpenInMenu } from "@/components/project/open-in-menu";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
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
  const {
    projectId: routeProjectId,
    spaceId,
    chatId,
  } = useParams({ strict: false }) as {
    projectId: string;
    spaceId: string;
    chatId?: string;
  };
  const { artifacts } = useProjectContext();
  const { instances } = useWSState();
  const { addMessageHandler, send } = useWSMethods();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectId = artifacts.projectId || routeProjectId;
  const spaceQueryKey = ["space", spaceId] as const;
  const chatsQueryKey = ["projectChats", projectId] as const;
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
  const [showSidebar, setShowSidebar] = useState(true);
  const toggleSidebarTab = (tab: SidebarTab) => {
    if (showSidebar && sidebarTab === tab) {
      setShowSidebar(false);
    } else {
      setSidebarTab(tab);
      setShowSidebar(true);
    }
  };
  const [spaceDiff, setSpaceDiff] = useState<string | null>(null);
  const [diffInitialLoad, setDiffInitialLoad] = useState(true);
  const [showDiffDrawer, setShowDiffDrawer] = useState(false);
  const [diffScrollToFile, setDiffScrollToFile] = useState<string | undefined>();

  const [closeTabId, setCloseTabId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);

  // Merge dialog state
  const [mergeDialog, setMergeDialog] = useState<
    | { phase: "confirm" }
    | { phase: "merging" }
    | { phase: "success"; targetBranch: string; mergeCommit?: string }
    | { phase: "error"; message: string }
    | null
  >(null);

  const { data: space } = useQuery({
    queryKey: spaceQueryKey,
    queryFn: () => fetchSpaceDetail(spaceId),
  });
  const { data: chatSummaries = [], isLoading: chatSummariesLoading } = useQuery({
    queryKey: chatsQueryKey,
    queryFn: () => fetchProjectChats(projectId),
    enabled: !!projectId,
  });

  useEffect(() => {
    return addMessageHandler((message) => {
      if (message.type === "instance_created" || message.type === "instance_removed") {
        void queryClient.invalidateQueries({ queryKey: chatsQueryKey });
        return;
      }
      if (message.type === "space_list" && message.projectDirectory === artifacts.directory) {
        const nextSpace = message.spaces.find((entry) => entry.id === spaceId);
        if (nextSpace) {
          queryClient.setQueryData(spaceQueryKey, nextSpace);
        } else {
          void queryClient.invalidateQueries({ queryKey: spaceQueryKey });
        }
        return;
      }
      if (
        (message.type === "space_completed" || message.type === "space_removed") &&
        message.spaceId === spaceId
      ) {
        navigate({
          to: "/projects/$projectId",
          params: { projectId },
          replace: true,
        });
      }
    });
  }, [
    addMessageHandler,
    artifacts.directory,
    chatsQueryKey,
    navigate,
    projectId,
    queryClient,
    spaceId,
    spaceQueryKey,
  ]);

  const spaceChatMap = new Map<string, InstanceInfo>();
  for (const chat of chatSummaries) {
    if (chat.spaceId === spaceId) {
      spaceChatMap.set(chat.id, chat);
    }
  }
  for (const instance of instances) {
    if (instance.spaceId === spaceId) {
      spaceChatMap.set(instance.id, instance);
    }
  }
  const spaceInstances = Array.from(spaceChatMap.values()).sort(
    (a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0),
  );

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

  const activeTab = chatId && spaceInstances.find((i) => i.id === chatId) ? chatId : null;
  const firstSpaceChatId = spaceInstances[0]?.id ?? null;
  const activeLiveInstance = activeTab
    ? instances.find((instance) => instance.id === activeTab)
    : null;

  // Auto-redirect to first chat when landing on space without a valid chatId
  useEffect(() => {
    if (!chatSummariesLoading && firstSpaceChatId && !activeTab && chatId !== firstSpaceChatId) {
      navigate({
        to: "/projects/$projectId/spaces/$spaceId/$chatId",
        params: { projectId, spaceId, chatId: firstSpaceChatId },
        replace: true,
      });
    }
  }, [activeTab, chatId, chatSummariesLoading, firstSpaceChatId, navigate, projectId, spaceId]);

  const navigateToChat = (id: string) => {
    navigate({
      to: "/projects/$projectId/spaces/$spaceId/$chatId",
      params: { projectId, spaceId, chatId: id },
    });
  };

  // Aggregate stats across all space chats
  const aggregatedStats = (() => {
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
  })();

  // Parse diff for file changes (used by header badge + sidebar)
  const fileChanges = (() => {
    if (!spaceDiff) return [] as FileChange[];
    const files: FileChange[] = [];
    const chunks = spaceDiff.split(/^diff --git /m).filter(Boolean);
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
  })();

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
    setCloseTabId(id);
  };

  const confirmCloseTab = () => {
    if (!closeTabId) return;
    send({ type: "remove_instance", instanceId: closeTabId });
    if (activeTab === closeTabId) {
      const remaining = spaceInstances.filter((i) => i.id !== closeTabId);
      if (remaining.length > 0) {
        navigateToChat(remaining[0].id);
      } else {
        navigate({
          to: "/projects/$projectId/spaces/$spaceId",
          params: { projectId, spaceId },
        });
      }
    }
    setCloseTabId(null);
  };

  const handleRenameTab = (instanceId: string, name: string) => {
    send({ type: "rename_instance", instanceId, name });
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

  const handlePush = async (createPR?: boolean) => {
    try {
      const result = await pushSpace(spaceId, { createPR });
      if (result.pushed) {
        if (result.prUrl) {
          toast.success(
            <span>
              PR created:{" "}
              <a
                href={result.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {result.prUrl}
              </a>
            </span>,
          );
        } else if (result.error) {
          toast.warning(result.error);
        } else {
          toast.success("Branch pushed to remote");
        }
      } else {
        toast.error(result.error || "Push failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to push");
    }
  };

  const handleDelete = () => {
    setConfirmDelete(true);
  };

  const confirmDeleteSpace = async () => {
    setConfirmDelete(false);
    try {
      await deleteSpace(spaceId);
      navigate({ to: "/projects/$projectId", params: { projectId } });
    } catch {
      // error handled by API
    }
  };

  const tabsScrollRef = useRef<HTMLDivElement>(null);
  const [tabsOverflow, setTabsOverflow] = useState({ left: false, right: false });

  const updateTabsOverflow = useCallback(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setTabsOverflow({
      left: scrollLeft > 2,
      right: scrollLeft + clientWidth < scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    updateTabsOverflow();
    el.addEventListener("scroll", updateTabsOverflow, { passive: true });

    // Observe size changes of the container AND all children (covers renames, content changes)
    const ro = new ResizeObserver(updateTabsOverflow);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);

    // Convert vertical wheel → horizontal scroll (like VS Code tabs),
    // but only when the strip is actually scrollable.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return; // not scrollable, let event propagate
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("scroll", updateTabsOverflow);
      el.removeEventListener("wheel", onWheel);
      ro.disconnect();
    };
  }, [updateTabsOverflow, spaceInstances.length]);

  if (!space) {
    return (
      <div className="flex h-full items-center justify-center text-muted">Loading space...</div>
    );
  }

  const projectName = getProjectName(artifacts.directory);

  const chatTabs = (
    <div className="relative flex shrink-0 items-center border-b border-border bg-surface">
      {/* Left fade */}
      <div
        className={`pointer-events-none absolute left-0 top-0 bottom-0 z-10 flex w-8 items-center justify-center bg-gradient-to-r from-surface via-surface/60 to-transparent transition-opacity duration-150 ${tabsOverflow.left ? "opacity-100" : "opacity-0"}`}
      >
        <ChevronLeft size={11} strokeWidth={2.5} className="text-muted" />
      </div>
      <div ref={tabsScrollRef} className="scrollbar-none flex items-center overflow-x-auto pl-1">
        {spaceInstances.map((inst) => (
          <SpaceChatTab
            key={inst.id}
            instance={inst}
            isActive={activeTab === inst.id}
            onClick={() => navigateToChat(inst.id)}
            onRename={(name) => handleRenameTab(inst.id, name)}
            onDelete={() => handleCloseTab(inst.id)}
          />
        ))}
        <button
          onClick={handleNewChat}
          className="flex shrink-0 h-full items-center px-2.5 py-2 text-muted transition-colors hover:bg-surface-hover hover:text-accent"
        >
          <Plus size={13} strokeWidth={2.5} />
        </button>
      </div>
      {/* Right fade */}
      <div
        className={`pointer-events-none absolute right-0 top-0 bottom-0 z-10 flex w-8 items-center justify-center bg-gradient-to-l from-surface via-surface/60 to-transparent transition-opacity duration-150 ${tabsOverflow.right ? "opacity-100" : "opacity-0"}`}
      >
        <ChevronRight size={11} strokeWidth={2.5} className="text-muted" />
      </div>
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
          {projectName}
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
        <div className="flex items-center gap-1.5">
          <OpenInMenu path={space.worktreePath || artifacts.directory} className="hidden sm:flex" />
          <Tooltip
            content={spaceInstances.length === 0 ? "Start a chat first" : "Complete & merge"}
          >
            <Button
              variant="primary"
              size="sm"
              onClick={() => setMergeDialog({ phase: "confirm" })}
              disabled={spaceInstances.length === 0}
              className="h-7"
            >
              <GitMerge size={13} />
              Complete
            </Button>
          </Tooltip>

          <Menu.Root>
            <Menu.Trigger className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-all duration-150 hover:bg-surface-hover hover:text-text">
              <EllipsisVertical size={14} />
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item onClick={() => void handlePush(false)}>
                <Upload size={13} className="text-muted" />
                Push branch
              </Menu.Item>
              <Menu.Item onClick={() => void handlePush(true)}>
                <GitPullRequest size={13} className="text-muted" />
                Push & create PR
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item onClick={() => setShowDebug(true)}>
                <Bug size={13} strokeWidth={2} className="text-muted" />
                Debug
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item danger onClick={handleDelete}>
                <Trash2 size={13} />
                Delete space
              </Menu.Item>
            </Menu.Content>
          </Menu.Root>

          {(spaceInstances.length > 0 || chatSummariesLoading) && (
            <>
              <HeaderActionDivider />
              {chatSummariesLoading && spaceInstances.length === 0 ? (
                <>
                  <HeaderIconSkeleton />
                  <HeaderIconSkeleton />
                </>
              ) : (
                <>
                  <Tooltip
                    content={showSidebar && sidebarTab === "files" ? "Hide files" : "Show files"}
                  >
                    <Button
                      variant="icon"
                      toggled={showSidebar && sidebarTab === "files"}
                      onClick={() => toggleSidebarTab("files")}
                      className="relative shrink-0"
                    >
                      <FileText size={15} strokeWidth={2} />
                      {fileChanges.length > 0 && (
                        <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 text-[0.5625rem] font-semibold leading-none text-white">
                          {fileChanges.length}
                        </span>
                      )}
                    </Button>
                  </Tooltip>
                  <HeaderContextToggle
                    stats={activeLiveInstance?.stats}
                    active={showSidebar && sidebarTab === "context"}
                    tooltip={
                      showSidebar && sidebarTab === "context" ? "Hide context" : "Show context"
                    }
                    onClick={() => toggleSidebarTab("context")}
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Worktree info bar ── */}
      {!space.isDefault && space.worktreePath && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-hover/40 px-4 py-1.5 text-xs text-muted">
          <FolderOpen size={13} className="shrink-0 text-muted/70" />
          <Tooltip content={pathCopied ? "Copied!" : "Click to copy path"}>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(space.worktreePath!).then(() => {
                  setPathCopied(true);
                  setTimeout(() => setPathCopied(false), 1500);
                  toast.success("Copied to clipboard");
                });
              }}
              className="min-w-0 truncate font-mono text-[0.6875rem] text-muted transition-colors hover:text-text"
            >
              {space.worktreePath}
            </button>
          </Tooltip>
          <Tooltip content="This space uses a separate working copy (git worktree). Changes here won't appear in your main project directory. Open a terminal at this path to run your dev server against this copy.">
            <button
              type="button"
              className="inline-flex shrink-0 items-center rounded px-1 py-0.5 text-muted/70 transition-colors hover:text-text"
            >
              <Info size={12} />
            </button>
          </Tooltip>
        </div>
      )}

      {/* ── Main content: tabs + chat | sidebar ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {activeTab ? (
          showSidebar ? (
            <Group orientation="horizontal" className="flex-1">
              <Panel defaultSize="70" minSize="40">
                <div className="flex h-full flex-col">
                  {chatTabs}
                  {activeLiveInstance ? (
                    <InstanceView key={activeTab} instanceId={activeTab} compact />
                  ) : (
                    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
                      <div className="flex w-full max-w-md flex-col items-center px-6 py-8 text-center">
                        <Spinner size={18} />
                        <p className="mt-4 text-[0.875rem] font-medium text-text-bright">
                          Restoring chat
                        </p>
                        <p className="mt-1 text-[0.75rem] text-muted">
                          Waiting for the live chat state to reconnect.
                        </p>
                      </div>
                    </div>
                  )}
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
                  fileChanges={fileChanges}
                  diffLoading={diffInitialLoad}
                  onOpenDiff={(scrollTo) => {
                    setDiffScrollToFile(scrollTo);
                    setShowDiffDrawer(true);
                  }}
                />
              </Panel>
            </Group>
          ) : (
            <div className="flex h-full flex-1 flex-col">
              {chatTabs}
              {activeLiveInstance ? (
                <InstanceView key={activeTab} instanceId={activeTab} compact />
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
                  <div className="flex w-full max-w-md flex-col items-center px-6 py-8 text-center">
                    <Spinner size={18} />
                    <p className="mt-4 text-[0.875rem] font-medium text-text-bright">
                      Restoring chat
                    </p>
                    <p className="mt-1 text-[0.75rem] text-muted">
                      Waiting for the live chat state to reconnect.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <GitBranch size={32} className="text-muted/30" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-text-bright">Space ready</p>
              <p className="max-w-xs text-[0.8125rem] text-muted">
                This space has its own branch and working copy. Start a chat to begin working.
              </p>
            </div>
            {space.worktreePath && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-hover/50 px-3 py-2 text-xs">
                <FolderOpen size={13} className="shrink-0 text-muted/70" />
                <code
                  className="max-w-[20rem] truncate font-mono text-[0.6875rem] text-muted"
                  title={space.worktreePath}
                >
                  {space.worktreePath}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(space.worktreePath!).then(() => {
                      setPathCopied(true);
                      setTimeout(() => setPathCopied(false), 1500);
                      toast.success("Copied to clipboard");
                    });
                  }}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] text-muted transition-colors hover:bg-surface-hover hover:text-text"
                >
                  {pathCopied ? <Check size={11} /> : <Copy size={11} />}
                  {pathCopied ? "Copied" : "Copy"}
                </button>
              </div>
            )}
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

      {/* Close tab confirmation */}
      <ConfirmActionDialog
        open={closeTabId !== null}
        onOpenChange={(open) => {
          if (!open) setCloseTabId(null);
        }}
        title="Remove chat?"
        description={
          <>
            <span className="font-medium text-text">
              {spaceInstances.find((i) => i.id === closeTabId)?.name || "This chat"}
            </span>{" "}
            will be removed from this space.
          </>
        }
        confirmLabel="Remove"
        onConfirm={confirmCloseTab}
      />

      {/* Delete space confirmation */}
      <ConfirmActionDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete space?"
        description={
          <>
            <span className="font-medium text-text">{space?.name}</span> will be deleted and its
            worktree removed without merging.
          </>
        }
        confirmLabel="Delete"
        onConfirm={confirmDeleteSpace}
      />

      {/* Debug modal */}
      {showDebug && space && (
        <SpaceDebugModal
          space={space}
          instances={spaceInstances}
          defaultInstanceId={activeTab ?? undefined}
          onClose={() => setShowDebug(false)}
        />
      )}
    </div>
  );
}

// =============================================================================
// Space chat tab — with inline rename + 3-dot menu
// =============================================================================

function SpaceChatTab({
  instance,
  isActive,
  onClick,
  onRename,
  onDelete,
}: {
  instance: InstanceInfo;
  isActive: boolean;
  onClick: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEditing = () => {
    setEditValue(instance.name);
    setEditing(true);
  };

  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== instance.name) {
      onRename(trimmed);
    }
    setEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") setEditing(false);
  };

  return (
    <div
      role="tab"
      tabIndex={0}
      onClick={() => {
        if (!editing) onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !editing) onClick();
      }}
      className={`group/tab relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 py-2 text-[0.8125rem] transition-colors ${
        isActive
          ? "bg-background text-text-bright shadow-[inset_0_-2px_0_0_var(--color-accent)]"
          : "text-muted hover:bg-surface-hover hover:text-text"
      }`}
    >
      <StatusDot status={instance.status} />
      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleEditKeyDown}
          className="w-[120px] rounded bg-bg px-1 py-0.5 text-[0.8125rem] font-medium text-text-bright outline-none ring-1 ring-accent"
        />
      ) : (
        <span className="max-w-[140px] truncate font-medium">{instance.name}</span>
      )}
      <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Menu.Trigger
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
          }}
          className={`ml-0.5 flex h-4 w-4 items-center justify-center rounded transition-opacity hover:bg-surface-hover ${
            editing
              ? "hidden"
              : "opacity-0 group-hover/tab:opacity-100 data-[popup-open]:opacity-100"
          }`}
        >
          <MoreVertical size={11} />
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              startEditing();
            }}
          >
            <Pencil size={13} strokeWidth={2} className="text-muted" />
            Rename
          </Menu.Item>
          <Menu.Item
            danger
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 size={13} strokeWidth={2} />
            Remove
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </div>
  );
}

// =============================================================================
// Space debug modal
// =============================================================================

function SpaceDebugModal({
  space,
  instances,
  defaultInstanceId,
  onClose,
}: {
  space: SpaceInfo;
  instances: InstanceInfo[];
  defaultInstanceId?: string;
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState(defaultInstanceId ?? instances[0]?.id ?? "");
  const [copied, setCopied] = useState(false);

  const selectedInstance = instances.find((i) => i.id === selectedId);
  const debugDump = JSON.stringify({ space, instance: selectedInstance ?? null }, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(debugDump).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content maxWidth="max-w-3xl">
        <Dialog.Header>
          <Dialog.Title>Debug — {space.name}</Dialog.Title>
          <Dialog.Close />
        </Dialog.Header>
        {instances.length > 1 && (
          <div className="flex gap-1 rounded-lg bg-bg p-1">
            {instances.map((inst) => (
              <button
                key={inst.id}
                onClick={() => setSelectedId(inst.id)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.75rem] font-medium transition-colors ${
                  selectedId === inst.id
                    ? "bg-surface-hover text-text-bright"
                    : "text-muted hover:text-text"
                }`}
              >
                <StatusDot status={inst.status} />
                <span className="max-w-[120px] truncate">{inst.name}</span>
              </button>
            ))}
          </div>
        )}
        <pre
          className="flex-1 overflow-auto rounded-lg border border-border bg-bg p-3.5 font-mono text-[0.75rem] leading-relaxed text-text"
          style={{ maxHeight: "55vh" }}
        >
          {debugDump}
        </pre>
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={handleCopy}
            className={copied ? "bg-accent/15 text-accent hover:bg-accent/25" : ""}
          >
            {copied ? "Copied!" : "Copy to Clipboard"}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
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
  fileChanges,
  diffLoading,
  onOpenDiff,
}: {
  space: SpaceInfo;
  instances: InstanceInfo[];
  activeTab: SidebarTab;
  onChangeTab: (tab: SidebarTab) => void;
  stats: SessionStats | null;
  fileChanges: FileChange[];
  diffLoading: boolean;
  onOpenDiff: (scrollToFile?: string) => void;
}) {
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
          label="Files"
          badge={fileChanges.length > 0 ? fileChanges.length : undefined}
        />
        <TabButton
          active={activeTab === "context"}
          onClick={() => onChangeTab("context")}
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
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
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
  const totalTokens = stats ? stats.inputTokens + stats.outputTokens : 0;
  const cacheRead = stats?.cacheReadTokens ?? 0;
  const cacheWrite = stats?.cacheCreationTokens ?? 0;
  const pureInput = stats?.inputTokens ?? 0;
  const output = stats?.outputTokens ?? 0;
  const breakdownTotal = pureInput + cacheRead + cacheWrite + output;

  const segments =
    breakdownTotal > 0
      ? [
          { label: "Input", pct: (pureInput / breakdownTotal) * 100, color: "bg-blue-400" },
          { label: "Cache read", pct: (cacheRead / breakdownTotal) * 100, color: "bg-emerald-400" },
          { label: "Cache write", pct: (cacheWrite / breakdownTotal) * 100, color: "bg-amber-400" },
          { label: "Output", pct: (output / breakdownTotal) * 100, color: "bg-purple-400" },
        ].filter((s) => s.pct > 0)
      : [];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-3.5 py-2.5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <StatRow label="Branch" value={space.gitBranch ?? "—"} />
          <StatRow label="Status" value={space.status} />
          <StatRow label="Chats" value={instances.length} />
          {activeCount > 0 && <StatRow label="Active" value={activeCount} />}
          {stoppedCount > 0 && <StatRow label="Ended" value={stoppedCount} />}
          {stats && (
            <>
              <div className="col-span-2 border-t border-border/30" />
              <StatRow label="Total Tokens" value={formatTokens(totalTokens)} />
              <StatRow label="Input Tokens" value={formatTokens(pureInput)} />
              <StatRow label="Output Tokens" value={formatTokens(output)} />
              <StatRow
                label="Cache Tokens (read/write)"
                value={`${formatTokens(cacheRead)} / ${formatTokens(cacheWrite)}`}
              />
            </>
          )}
          <div className="col-span-2 border-t border-border/30" />
          <StatRow label="Created" value={formatTimestamp(space.createdAt)} />
        </div>

        {/* Token breakdown bar */}
        {segments.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 text-[0.6875rem] text-muted">Token Breakdown</div>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-hover">
              {segments.map((seg) => (
                <Tooltip key={seg.label} content={`${seg.label} ${seg.pct.toFixed(1)}%`}>
                  <div className={`h-full ${seg.color}`} style={{ width: `${seg.pct}%` }} />
                </Tooltip>
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
              {segments.map((seg) => (
                <span
                  key={seg.label}
                  className="flex items-center gap-1 text-[0.625rem] text-muted"
                >
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${seg.color}`} />
                  {seg.label} {seg.pct.toFixed(1)}%
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Per-chat breakdown */}
      {instances.length > 0 && (
        <div className="border-t border-border/30">
          <div className="px-3.5 py-2.5 text-[0.6875rem] text-muted">Per-chat</div>
          <div className="flex flex-col gap-0.5 px-3.5 pb-3">
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
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Shared primitives
// =============================================================================

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.6875rem] text-muted">{label}</span>
      <span className="text-[0.8125rem] font-medium text-text-bright">{value}</span>
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
