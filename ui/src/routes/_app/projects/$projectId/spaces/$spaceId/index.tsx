import { lazy, useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  Archive,
  Bug,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  EllipsisVertical,
  ExternalLink,
  FileText,
  FolderOpen,
  GitBranch,
  LayoutGrid,
  MoreVertical,
  Pencil,
  Plus,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import { Group, Panel } from "react-resizable-panels";
import { useWSState, useWSMethods } from "@/context/websocket-context";
import { useProjectContext } from "@/context/project-context";
import { InstanceView } from "@/components/chat/instance-view";
import { ResizableHandle } from "@/components/ui/resizable-handle";
import { Tooltip } from "@/components/ui/tooltip";
import {
  ViewHeader,
  ViewHeaderBreadcrumb,
  ViewHeaderTitle,
  BranchBadge,
  TokenBadge,
  MobileSidebarToggle,
} from "@/components/ui/view-header";
import { Menu } from "@/components/ui/menu";
import { GitMenu } from "@/components/ui/git-menu";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  commitSpace,
  completeSpace,
  deleteSpace,
  fetchProjectChats,
  fetchSpaceDetail,
  fetchSpaceDiff,
  pushSpace,
} from "@/lib/api";
import { getProjectName } from "@/lib/project-route";
import { formatTokens, getDisplaySessionStats, instanceStatusVariant } from "@/lib/utils";
import { HeaderContextToggle, HeaderIconSkeleton } from "@/components/chat/header-actions";
import { FilesPanel } from "@/components/chat/files-panel";
import { ContextPanel } from "@/components/chat/context-panel";
import { StatusDot } from "@/components/ui/status-dot";
import { Badge } from "@/components/ui/badge";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSidecarPanels, type SidecarTab } from "@/hooks/use-sidecar-store";
import "@/components/chat/sidecar.css";
import { OpenInMenu } from "@/components/project/open-in-menu";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { ConfirmMergeDialog } from "@/components/spaces/confirm-merge-dialog";
import { CommitMessageDialog } from "@/components/git/commit-message-dialog";
import { GhCliRequiredDialog } from "@/components/git/gh-cli-required-dialog";
const DiffDrawer = lazy(() =>
  import("@/components/chat/diff-drawer").then((m) => ({ default: m.DiffDrawer })),
);
import { useTerminalStore } from "@/hooks/use-terminal-store";
import { useVerticalResize } from "@/hooks/use-vertical-resize";
import { TerminalPanel } from "@/components/terminal/terminal-panel";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import type {
  SpaceInfo,
  InstanceInfo,
  SessionStats,
  FileChange,
  TerminalScope,
} from "@shared/types";

// =============================================================================
// Space view — owns the full viewport below the sidebar
// =============================================================================

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
  const [spaceDiff, setSpaceDiff] = useState<string | null>(null);
  const [showDiffDrawer, setShowDiffDrawer] = useState(false);
  const [diffScrollToFile, setDiffScrollToFile] = useState<string | undefined>();

  const [closeTabId, setCloseTabId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [pathCopied, setPathCopied] = useState(false);
  const [editingSpaceName, setEditingSpaceName] = useState(false);
  const [spaceNameDraft, setSpaceNameDraft] = useState("");
  const [commitDialogOpen, setCommitDialogOpen] = useState(false);
  const [ghCliDialogOpen, setGhCliDialogOpen] = useState(false);
  const [ghCliReason, setGhCliReason] = useState<"not-installed" | "not-authenticated">(
    "not-installed",
  );

  // Merge dialog state
  const [mergeDialog, setMergeDialog] = useState<
    | { phase: "confirm" }
    | { phase: "merging" }
    | { phase: "success"; targetBranch: string; mergeCommit?: string; mergeMethod?: string }
    | { phase: "error"; message: string }
    | null
  >(null);
  const spaceNameInputRef = useRef<HTMLInputElement>(null);

  // ── Terminal panel state ──────────────────────────────────────────
  const terminalScope: TerminalScope = { type: "space", spaceId };
  const terminalScopeKey = `space:${spaceId}`;
  const { isPanelOpen: isTerminalPanelOpen, togglePanel: toggleTerminalPanel } = useTerminalStore();
  const showTerminalPanel = isTerminalPanelOpen(terminalScope);
  const { height: terminalHeight, onResizeStart: handleTerminalResizeStart } = useVerticalResize();
  const handleToggleTerminal = () => toggleTerminalPanel(terminalScopeKey);

  // Ctrl+` keyboard shortcut to toggle terminal
  const handleToggleTerminalRef = useRef(handleToggleTerminal);
  handleToggleTerminalRef.current = handleToggleTerminal;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "`" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleToggleTerminalRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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
      // On archive/delete, redirect to project — but not on complete,
      // because the success dialog handles post-merge navigation.
      if (message.type === "space_removed" && message.spaceId === spaceId) {
        navigate({
          to: "/projects/$projectId",
          params: { projectId },
          replace: true,
        });
      }
      // Refresh space data when completed so the detail page can show read-only state
      if (message.type === "space_completed" && message.spaceId === spaceId) {
        void queryClient.invalidateQueries({ queryKey: spaceQueryKey });
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

  const isActive = space?.status === "active";
  const isMerged = space?.status === "completed";
  const isArchived = space?.status === "archived";

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
    (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
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
        const display = getDisplaySessionStats(inst.provider, inst.stats);
        hasAny = true;
        inputTokens += display.inputTokens;
        outputTokens += display.outputTokens;
        cacheCreationTokens += display.cacheCreationTokens;
        cacheReadTokens += display.cacheReadTokens;
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

  const isMobile = useMediaQuery("(max-width: 768px)");
  const hasStats =
    !!aggregatedStats && (aggregatedStats.inputTokens > 0 || aggregatedStats.outputTokens > 0);
  const {
    activePanels,
    mobileOpen: sidecarMobileOpen,
    setMobileOpen: setSidecarMobileOpen,
    togglePanel,
    sidecarContentCount,
    allContentPanels,
    showDesktopSidecar: showSidebar,
  } = useSidecarPanels({
    instanceId: spaceId,
    isMobile,
    hasTasksContent: false,
    hasFilesContent: fileChanges.length > 0,
    hasPlanContent: false,
    hasStats,
  });

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

  useEffect(() => {
    if (editingSpaceName) {
      spaceNameInputRef.current?.focus();
      spaceNameInputRef.current?.select();
    }
  }, [editingSpaceName]);

  const startRenamingSpace = () => {
    if (!space || space.isDefault) return;
    setSpaceNameDraft(space.name);
    setEditingSpaceName(true);
  };

  const commitSpaceRename = () => {
    if (!space) return;
    const trimmed = spaceNameDraft.trim();
    if (trimmed && trimmed !== space.name) {
      send({ type: "rename_space", spaceId: space.id, name: trimmed });
    }
    setEditingSpaceName(false);
  };

  const handleComplete = async (mergeMethod?: string, squashMessage?: string) => {
    setMergeDialog({ phase: "merging" });
    try {
      const result = await completeSpace(spaceId, {
        mergeMethod: mergeMethod as "squash" | "merge-commit" | "rebase-ff" | undefined,
        squashMessage,
      });
      setMergeDialog({
        phase: "success",
        targetBranch: result.targetBranch,
        mergeCommit: result.mergeCommit,
        mergeMethod: result.mergeMethod,
      });
      toast.success(`Merged "${space?.name}" into ${result.targetBranch}`);
    } catch (err) {
      setMergeDialog({
        phase: "error",
        message: err instanceof Error ? err.message : "Merge failed",
      });
    }
  };

  const handleCommit = async (message: string) => {
    try {
      const result = await commitSpace(spaceId, { message });
      if (result.success) {
        toast.success("Changes committed");
        // Refresh diff so the Files panel reflects the commit
        fetchSpaceDiff(spaceId)
          .then((d) => setSpaceDiff(d))
          .catch(() => setSpaceDiff(""));
      } else {
        toast.error(result.error || "Commit failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to commit");
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
        } else if (result.ghNotFound) {
          setGhCliReason("not-installed");
          setGhCliDialogOpen(true);
        } else if (result.ghNotAuthenticated) {
          setGhCliReason("not-authenticated");
          setGhCliDialogOpen(true);
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
      <ViewHeader>
        <MobileSidebarToggle />
        <ViewHeaderBreadcrumb
          to="/projects/$projectId"
          params={{ projectId }}
          label={projectName}
        />
        <GitBranch size={14} className="shrink-0 text-accent" />
        <ViewHeaderTitle>
          {editingSpaceName ? (
            <input
              ref={spaceNameInputRef}
              value={spaceNameDraft}
              onChange={(e) => setSpaceNameDraft(e.target.value)}
              onBlur={commitSpaceRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitSpaceRename();
                if (e.key === "Escape") setEditingSpaceName(false);
              }}
              className="w-[12rem] max-w-[40vw] rounded border border-border bg-surface px-2 py-0.5 text-sm font-semibold text-text-bright outline-none focus:border-accent"
            />
          ) : (
            <span className="truncate text-sm font-semibold text-text-bright">{space.name}</span>
          )}
          {space.gitBranch && <BranchBadge branch={space.gitBranch} />}
          {isMerged && (
            <Badge variant="success" size="sm">
              Merged
            </Badge>
          )}
          {isArchived && (
            <Badge variant="default" size="sm">
              Archived
            </Badge>
          )}
          {isActive && space.remoteStatus === "pr-open" && (
            <Badge
              variant="accent"
              size="sm"
              className={space.prUrl ? "cursor-pointer" : ""}
              onClick={space.prUrl ? () => window.open(space.prUrl!, "_blank") : undefined}
            >
              PR open
              {space.prUrl && <ExternalLink size={10} />}
            </Badge>
          )}
          {isActive && space.remoteStatus === "pushed" && (
            <Badge variant="accent" size="sm">
              Pushed
            </Badge>
          )}
          {isActive && !space.remoteStatus && (
            <Badge variant="default" size="sm">
              Local only
            </Badge>
          )}
          <TokenBadge
            tokens={spaceInstances.reduce(
              (sum, inst) => sum + (inst.stats?.inputTokens ?? 0) + (inst.stats?.outputTokens ?? 0),
              0,
            )}
            tooltip={`${formatTokens(
              spaceInstances.reduce(
                (sum, inst) =>
                  sum + (inst.stats?.inputTokens ?? 0) + (inst.stats?.outputTokens ?? 0),
                0,
              ),
            )} tokens across ${spaceInstances.length} chat${spaceInstances.length !== 1 ? "s" : ""}`}
          />
          <Menu.Root>
            <Menu.Trigger className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-all duration-150 hover:bg-surface-hover hover:text-text">
              <EllipsisVertical size={14} />
            </Menu.Trigger>
            <Menu.Content>
              {!space.isDefault && isActive && (
                <Menu.Item onClick={startRenamingSpace}>
                  <Pencil size={13} strokeWidth={2} className="text-muted" />
                  Rename
                </Menu.Item>
              )}
              <Menu.Item onClick={() => setShowDebug(true)}>
                <Bug size={13} strokeWidth={2} className="text-muted" />
                Debug
              </Menu.Item>
              {!space.isDefault && isActive && (
                <>
                  <Menu.Separator />
                  <Menu.Item danger onClick={handleDelete}>
                    <Archive size={13} />
                    Archive space
                  </Menu.Item>
                </>
              )}
            </Menu.Content>
          </Menu.Root>
        </ViewHeaderTitle>

        {/* Right actions */}
        <div className="flex items-center gap-1.5">
          {isActive && (
            <>
              <OpenInMenu
                path={space.worktreePath || artifacts.directory}
                className="hidden sm:flex"
              />
              <GitMenu
                onCommit={() => setCommitDialogOpen(true)}
                onMerge={() => setMergeDialog({ phase: "confirm" })}
                mergeDisabled={spaceInstances.length === 0}
                onPush={() => void handlePush(false)}
                onPushAndCreatePR={() => void handlePush(true)}
                worktreePath={space.worktreePath || undefined}
              />
              {!isMobile && (
                <Tooltip content={showTerminalPanel ? "Hide terminal" : "Show terminal"}>
                  <Button
                    variant="icon"
                    toggled={showTerminalPanel}
                    onClick={handleToggleTerminal}
                    className="shrink-0"
                  >
                    <TerminalSquare size={15} strokeWidth={2} />
                  </Button>
                </Tooltip>
              )}
            </>
          )}
          <CommitMessageDialog
            open={commitDialogOpen}
            onOpenChange={setCommitDialogOpen}
            onCommit={(msg) => void handleCommit(msg)}
          />
          <GhCliRequiredDialog
            open={ghCliDialogOpen}
            onOpenChange={setGhCliDialogOpen}
            reason={ghCliReason}
          />

          {(spaceInstances.length > 0 || chatSummariesLoading) && (
            <>
              {chatSummariesLoading && spaceInstances.length === 0 ? (
                <>
                  <HeaderIconSkeleton />
                  <HeaderIconSkeleton />
                </>
              ) : isMobile ? (
                sidecarContentCount > 0 && (
                  <Tooltip content="Sidecar">
                    <Button
                      variant="icon"
                      onClick={() => setSidecarMobileOpen(true)}
                      className="relative shrink-0"
                    >
                      <LayoutGrid size={15} strokeWidth={2} />
                      <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-claude px-0.5 text-[0.5625rem] font-semibold leading-none text-white">
                        {sidecarContentCount}
                      </span>
                    </Button>
                  </Tooltip>
                )
              ) : (
                <>
                  <Tooltip content={activePanels.has("files") ? "Hide files" : "Show files"}>
                    <Button
                      variant="icon"
                      toggled={activePanels.has("files")}
                      onClick={() => togglePanel("files")}
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
                    active={activePanels.has("context")}
                    tooltip={activePanels.has("context") ? "Hide context" : "Show context"}
                    onClick={() => togglePanel("context")}
                  />
                </>
              )}
            </>
          )}
        </div>
      </ViewHeader>

      {/* ── Read-only banner for merged/archived spaces ── */}
      {isMerged && (
        <div className="flex items-center gap-2 border-b border-border bg-surface-dim px-4 py-2 text-xs text-text-muted">
          <span>
            This space has been merged into{" "}
            <span className="font-medium text-text">{space.targetBranch || "the main branch"}</span>
            .
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: "/projects/$projectId", params: { projectId } })}
            className="ml-auto text-xs"
          >
            Go to main workspace
          </Button>
        </div>
      )}
      {isArchived && (
        <div className="flex items-center gap-2 border-b border-border bg-surface-dim px-4 py-2 text-xs text-text-muted">
          This space has been archived. Chats and history are still available.
        </div>
      )}

      {/* ── Main content: tabs + chat | sidebar ── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {activeTab ? (
            showSidebar && !isMobile ? (
              <Group orientation="horizontal" className="flex-1">
                <Panel defaultSize="70" minSize="40">
                  <div className="flex h-full flex-col overflow-hidden">
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
                    activePanels={activePanels}
                    stats={aggregatedStats}
                    fileChanges={fileChanges}
                    onOpenDiff={(scrollTo) => {
                      setDiffScrollToFile(scrollTo);
                      setShowDiffDrawer(true);
                    }}
                  />
                </Panel>
              </Group>
            ) : (
              <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
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
        {showTerminalPanel && !isMobile && (
          <ErrorBoundary name="Terminal panel">
            <TerminalPanel
              scope={terminalScope}
              height={terminalHeight}
              onResizeStart={handleTerminalResizeStart}
              activeInstanceId={activeTab}
            />
          </ErrorBoundary>
        )}
      </div>

      {/* Mobile sidecar overlay */}
      {isMobile && sidecarMobileOpen && sidecarContentCount > 0 && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          onClick={() => setSidecarMobileOpen(false)}
        >
          <div className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative h-full" onClick={(e) => e.stopPropagation()}>
            <SpaceSidebar
              space={space}
              instances={spaceInstances}
              activePanels={allContentPanels}
              stats={aggregatedStats}
              fileChanges={fileChanges}
              onOpenDiff={(scrollTo) => {
                setDiffScrollToFile(scrollTo);
                setShowDiffDrawer(true);
                setSidecarMobileOpen(false);
              }}
              isMobileOverlay
              onClose={() => setSidecarMobileOpen(false)}
            />
          </div>
        </div>
      )}

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
        targetBranch={space?.targetBranch || undefined}
        onConfirm={(mergeMethod, squashMessage) => handleComplete(mergeMethod, squashMessage)}
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

      {/* Archive space confirmation */}
      <ConfirmActionDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Archive this space?"
        description={
          <>
            This removes <span className="font-medium text-text">{space?.name}</span> from active
            work and deletes its separate working copy without merging it into the main workspace.
            Chats and history remain available in Closed spaces.
          </>
        }
        confirmLabel="Archive space"
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
      <StatusDot variant={instanceStatusVariant(instance.status)} />
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
                <StatusDot variant={instanceStatusVariant(inst.status)} />
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
  activePanels,
  stats,
  fileChanges,
  onOpenDiff,
  isMobileOverlay,
  onClose,
}: {
  space: SpaceInfo;
  instances: InstanceInfo[];
  activePanels: ReadonlySet<SidecarTab>;
  stats: SessionStats | null;
  fileChanges: FileChange[];
  onOpenDiff: (scrollToFile?: string) => void;
  isMobileOverlay?: boolean;
  onClose?: () => void;
}) {
  const activeCount = instances.filter(
    (i) => i.status === "idle" || i.status === "processing",
  ).length;
  const stoppedCount = instances.filter((i) => i.status === "stopped").length;

  const hasFiles = activePanels.has("files") && fileChanges.length > 0;
  const hasStats =
    activePanels.has("context") && !!stats && (stats.inputTokens > 0 || stats.outputTokens > 0);

  type Tab = { key: string; label: string; count: number };
  const availableTabs: Tab[] = [];
  if (hasFiles) availableTabs.push({ key: "files", label: "Files", count: fileChanges.length });
  if (hasStats) availableTabs.push({ key: "context", label: "Context", count: 0 });

  const [activeTab, setActiveTab] = useState(availableTabs[0]?.key ?? "files");
  const effectiveTab = availableTabs.find((t) => t.key === activeTab)?.key ?? availableTabs[0]?.key;

  // Auto-switch to newly toggled panel
  const prevPanelsRef = useRef(activePanels);
  useEffect(() => {
    const prev = prevPanelsRef.current;
    prevPanelsRef.current = activePanels;
    for (const panel of activePanels) {
      if (!prev.has(panel)) {
        setActiveTab(panel);
        return;
      }
    }
  }, [activePanels]);

  return (
    <div
      className={
        isMobileOverlay
          ? "@container/sidecar animate-slide-in-right flex h-full w-[85vw] max-w-sm flex-col overflow-hidden rounded-l-2xl border-l border-border bg-surface shadow-2xl"
          : "@container/sidecar flex h-full flex-col border-l border-border bg-surface"
      }
    >
      {/* Header */}
      <div className="flex shrink-0 items-center border-b border-border/60">
        {isMobileOverlay && onClose && (
          <Button variant="icon" size="icon-sm" onClick={onClose} className="ml-2 shrink-0">
            <X size={14} />
          </Button>
        )}
        <div className="flex min-w-0 flex-1 items-stretch">
          {availableTabs.map((tab) => {
            const isActive = tab.key === effectiveTab;
            const isSingle = availableTabs.length === 1;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => !isSingle && setActiveTab(tab.key)}
                className={`relative flex min-w-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                  isSingle
                    ? "cursor-default border-transparent text-text-bright"
                    : isActive
                      ? "flex-1 justify-center border-accent text-text-bright"
                      : "flex-1 justify-center border-transparent text-muted hover:text-text"
                }`}
              >
                <span className="truncate">{tab.label}</span>
                {tab.count > 0 && (
                  <span
                    className={`shrink-0 text-[0.6875rem] tabular-nums ${
                      isActive || isSingle ? "text-muted" : "text-muted/60"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {effectiveTab === "files" && hasFiles && (
          <FilesPanel
            files={fileChanges}
            cwd=""
            onViewChanges={() => onOpenDiff()}
            onFileClick={(path) => onOpenDiff(path)}
          />
        )}
        {effectiveTab === "context" && hasStats && (
          <ContextPanel
            mode="space"
            stats={stats!}
            instances={instances}
            branch={space.gitBranch ?? null}
            status={space.status}
            activeCount={activeCount}
            stoppedCount={stoppedCount}
            createdAt={space.createdAt}
          />
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_app/projects/$projectId/spaces/$spaceId/")({
  component: SpaceView,
});
