import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate, useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { useWSMethods, useWSState } from "@/context/websocket-context";
import { useProjectContext } from "@/context/project-context";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useTerminalShortcut } from "@/hooks/use-terminal-shortcut";
import { useVerticalResize } from "@/hooks/use-vertical-resize";
import { useSidecarPanels } from "@/stores/sidecar-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { SpaceViewBody } from "@/components/spaces/space-view-body";
import {
  SpaceViewDialogs,
  type SpaceMergeDialogState,
} from "@/components/spaces/space-view-dialogs";
import { SpaceViewHeader } from "@/components/spaces/space-view-header";
import { SpaceViewProvider } from "@/components/spaces/space-view-context";
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
import { aggregateSpaceStats, buildSpaceInstances, parseSpaceDiffFiles } from "@/lib/space-view";
import "@/components/chat/sidecar.css";
import type { TerminalScope } from "@shared/types";

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
  const projectName = getProjectName(artifacts.directory);
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
  const [mergeDialog, setMergeDialog] = useState<SpaceMergeDialogState>(null);

  const spaceNameInputRef = useRef<HTMLInputElement>(null);
  const prevSpaceInstanceIds = useRef(new Set<string>());
  const pendingNewChat = useRef(false);

  const terminalScope: TerminalScope = { type: "space", spaceId };
  const terminalScopeKey = `space:${spaceId}`;
  const {
    isPanelOpen: isTerminalPanelOpen,
    isPanelCollapsed: isTerminalPanelCollapsed,
    togglePanel: toggleTerminalPanel,
    expandPanel: expandTerminalPanel,
    getTerminalsForScope,
  } = useTerminalStore();
  const showTerminalPanel = isTerminalPanelOpen(terminalScope);
  const isTerminalCollapsed = isTerminalPanelCollapsed(terminalScope);
  const collapsedTerminalCount = isTerminalCollapsed
    ? getTerminalsForScope(terminalScope).length
    : 0;
  const { height: terminalHeight, onResizeStart: handleTerminalResizeStart } = useVerticalResize();
  const handleToggleTerminal = () => toggleTerminalPanel(terminalScopeKey);
  useTerminalShortcut(terminalScopeKey);

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
      if (message.type === "space_removed" && message.spaceId === spaceId) {
        navigate({
          to: "/projects/$projectId",
          params: { projectId },
          replace: true,
        });
        return;
      }
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

  const spaceInstances = buildSpaceInstances(spaceId, chatSummaries, instances);
  const hasActiveChats = spaceInstances.some(
    (instance) => instance.status === "idle" || instance.status === "processing",
  );

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchSpaceDiff(spaceId)
        .then((diff) => {
          if (!cancelled) setSpaceDiff(diff);
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

  const activeTab =
    chatId && spaceInstances.find((instance) => instance.id === chatId) ? chatId : null;
  const firstSpaceChatId = spaceInstances[0]?.id ?? null;
  const activeLiveInstance = activeTab
    ? (instances.find((instance) => instance.id === activeTab) ?? null)
    : null;
  const isResolvingChatSelection = chatSummariesLoading && !activeTab;

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

  const aggregatedStats = aggregateSpaceStats(spaceInstances);
  const fileChanges = parseSpaceDiffFiles(spaceDiff);
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

  useEffect(() => {
    const currentIds = new Set(spaceInstances.map((instance) => instance.id));
    if (pendingNewChat.current && prevSpaceInstanceIds.current.size > 0) {
      for (const instance of spaceInstances) {
        if (!prevSpaceInstanceIds.current.has(instance.id)) {
          pendingNewChat.current = false;
          navigateToChat(instance.id);
          break;
        }
      }
    }
    prevSpaceInstanceIds.current = currentIds;
  }, [spaceInstances]);

  useEffect(() => {
    if (editingSpaceName) {
      spaceNameInputRef.current?.focus();
      spaceNameInputRef.current?.select();
    }
  }, [editingSpaceName]);

  const isActive = space?.status === "active";
  const isMerged = space?.status === "completed";
  const isArchived = space?.status === "archived";

  const handleNewChat = () => {
    pendingNewChat.current = true;
    send({ type: "create_instance", spaceId });
  };

  const handleRenameTab = (instanceId: string, name: string) => {
    send({ type: "rename_instance", instanceId, name });
  };

  const confirmCloseTab = () => {
    if (!closeTabId) return;
    send({ type: "remove_instance", instanceId: closeTabId });
    if (activeTab === closeTabId) {
      const remaining = spaceInstances.filter((instance) => instance.id !== closeTabId);
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
      if (!result.success) {
        toast.error(result.error || "Commit failed");
        return;
      }
      toast.success("Changes committed");
      fetchSpaceDiff(spaceId)
        .then((diff) => setSpaceDiff(diff))
        .catch(() => setSpaceDiff(""));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to commit");
    }
  };

  const handlePush = async (createPR?: boolean) => {
    try {
      const result = await pushSpace(spaceId, { createPR });
      if (!result.pushed) {
        toast.error(result.error || "Push failed");
        return;
      }
      if (result.prUrl) {
        toast.success(
          <span>
            PR created:{" "}
            <a href={result.prUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {result.prUrl}
            </a>
          </span>,
        );
        return;
      }
      if (result.ghNotFound) {
        setGhCliReason("not-installed");
        setGhCliDialogOpen(true);
        return;
      }
      if (result.ghNotAuthenticated) {
        setGhCliReason("not-authenticated");
        setGhCliDialogOpen(true);
        return;
      }
      if (result.error) {
        toast.warning(result.error);
        return;
      }
      toast.success("Branch pushed to remote");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to push");
    }
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

  const handleCopyPath = () => {
    if (!space?.worktreePath) return;
    navigator.clipboard.writeText(space.worktreePath).then(() => {
      setPathCopied(true);
      setTimeout(() => setPathCopied(false), 1500);
      toast.success("Copied to clipboard");
    });
  };

  const handleSpaceNameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commitSpaceRename();
    if (e.key === "Escape") setEditingSpaceName(false);
  };

  const handleMergeSuccessDone = () => {
    setMergeDialog(null);
    navigate({ to: "/projects/$projectId", params: { projectId } });
  };

  const handleGoToMainWorkspace = () => {
    navigate({ to: "/projects/$projectId", params: { projectId } });
  };

  if (!space) {
    return (
      <div className="flex h-full items-center justify-center text-muted">Loading space...</div>
    );
  }

  const contextValue = {
    shared: {
      projectId,
      projectName,
      openInPath: space.worktreePath || artifacts.directory,
      space,
      spaceInstances,
      activeTab,
      activeLiveInstance,
      aggregatedStats,
      fileChanges,
      isActive,
      isMerged,
      isArchived,
      isMobile,
      isResolvingChatSelection,
      chatSummariesLoading,
      showSidebar,
      activePanels,
      allContentPanels,
      sidecarMobileOpen,
      sidecarContentCount,
      showTerminalPanel,
      isTerminalCollapsed,
      collapsedTerminalCount,
      terminalScope,
      terminalHeight,
      pathCopied,
      spaceDiff,
      showDiffDrawer,
      diffScrollToFile,
      mergeDialog,
      closeTabId,
      confirmDelete,
      showDebug,
      commitDialogOpen,
      ghCliDialogOpen,
      ghCliReason,
      editingSpaceName,
      spaceNameDraft,
      spaceNameInputRef,
    },
    actions: {
      setSpaceNameDraft,
      handleSpaceNameKeyDown,
      commitSpaceRename,
      startRenamingSpace,
      setShowDebug,
      setConfirmDelete,
      setCommitDialogOpen,
      setGhCliDialogOpen,
      setMergeDialog,
      handleCommit,
      handlePush,
      handleToggleTerminal,
      togglePanel,
      setSidecarMobileOpen,
      handleNewChat,
      navigateToChat,
      handleRenameTab,
      setCloseTabId,
      openDiff: (scrollTo?: string) => {
        setDiffScrollToFile(scrollTo);
        setShowDiffDrawer(true);
      },
      handleGoToMainWorkspace,
      handleCopyPath,
      handleTerminalResizeStart,
      expandTerminalPanel: () => expandTerminalPanel(terminalScopeKey),
      handleComplete,
      handleMergeSuccessDone,
      confirmCloseTab,
      confirmDeleteSpace,
      setShowDiffDrawer,
    },
  } as const;

  return (
    <SpaceViewProvider value={contextValue}>
      <div className="flex h-full flex-col overflow-hidden">
        <SpaceViewHeader />
        <SpaceViewBody />
        <SpaceViewDialogs />
      </div>
    </SpaceViewProvider>
  );
}

export const Route = createFileRoute("/_app/projects/$projectId/spaces/$spaceId/")({
  loader: async ({ params }) => {
    const chats = await fetchProjectChats(params.projectId);
    const fallbackChat = chats
      .filter((chat) => chat.spaceId === params.spaceId)
      .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))[0];

    if (fallbackChat) {
      throw redirect({
        to: "/projects/$projectId/spaces/$spaceId/$chatId",
        params: {
          projectId: params.projectId,
          spaceId: params.spaceId,
          chatId: fallbackChat.id,
        },
        replace: true,
      });
    }
  },
  component: SpaceView,
});
