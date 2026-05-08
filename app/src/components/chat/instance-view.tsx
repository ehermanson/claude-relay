import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { InstanceViewProvider } from "@/components/chat/instance-view-context";
import { InstanceViewShell } from "@/components/chat/instance-view-shell";
import { useWSMethods, useWSState } from "@/context/websocket-context";
import { useInstanceMessages } from "@/hooks/use-instance-messages";
import { useConnectionBanner } from "@/hooks/use-connection-banner";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { useSidecarPanels, useSidecarStore } from "@/stores/sidecar-store";
import { useUnreadStore } from "@/stores/unread-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useTerminalMessages } from "@/hooks/use-terminal-messages";
import { useTerminalShortcut } from "@/hooks/use-terminal-shortcut";
import { useVerticalResize } from "@/hooks/use-vertical-resize";
import { createInstance, fetchInstanceHistory, fetchInstanceSummary } from "@/lib/api";
import { getInstanceChatRoute, getInstanceProjectRouteId } from "@/lib/project-route";
import {
  buildReviewDraft,
  buildReviewSendBackMessage,
  getAttachedReviewInstance,
  getAttachedReviewInstances,
} from "@/lib/review-session";
import { buildProviderSwitchHandoffPrompt } from "@shared/session-handoff";
import { toast } from "sonner";
import type {
  FileChange,
  ProviderModelOptions,
  ProviderRuntimeMode,
  ReviewSessionInfo,
  ServerMessage,
  ProviderKind,
  TerminalScope,
  UserInputAnswer,
} from "@shared/types";

function filesFingerprint(files: FileChange[] | null | undefined): string {
  if (!files?.length) return "";
  return files
    .map((f) => `${f.path}:${f.type}:${f.editCount}`)
    .sort()
    .join("\n");
}

interface InstanceViewProps {
  /** Override the instance ID instead of reading from URL params. */
  instanceId?: string;
  /** Compact mode: hide header and sidecar (used in split view). */
  compact?: boolean;
  /** Parent/source chat when rendering a review inside its sidecar. */
  embeddedSourceChat?: { id: string; name: string };
}

export function InstanceView({
  instanceId: propId,
  compact,
  embeddedSourceChat,
}: InstanceViewProps = {}) {
  const { chatId: paramId } = useParams({ strict: false }) as {
    chatId?: string;
  };
  const routeSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const id = propId ?? paramId;
  const searchFocus =
    typeof routeSearch.q === "string" && routeSearch.q.trim()
      ? {
          query: routeSearch.q,
          snippet: typeof routeSearch.match === "string" ? routeSearch.match : undefined,
        }
      : null;
  const navigate = useNavigate({ from: "/projects/$projectId/chats/$chatId" });
  const { send, subscribe, unsubscribe, addMessageHandler, reconnectNow } = useWSMethods();
  const { isConnected, isSyncing, connectionId, instances } = useWSState();
  const {
    items,
    hasLoadedHistory,
    hasSyncedHistory,
    isProcessing,
    showThinkingIndicator,
    currentTasks,
    currentFiles,
    lastActivity,
    processingStartedAt,
    rawHistory,
    getReplayCursor,
    handleMessage,
    setInstanceId,
    showThinking,
    hydrateFromHistorySnapshot,
  } = useInstanceMessages();

  const liveInstance = instances.find((i) => i.id === id);
  const {
    data: summaryInstance,
    isFetching: isFetchingSummary,
    isFetched: hasFetchedSummary,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ["instance-summary", id],
    queryFn: () => fetchInstanceSummary(id!),
    enabled: !!id && !liveInstance,
    staleTime: 30_000,
    retry: 1,
  });
  const instance = liveInstance ?? summaryInstance ?? undefined;
  const attachedReviews = instance ? getAttachedReviewInstances(instance, instances) : [];
  const attachedReview = instance ? getAttachedReviewInstance(instance, instances) : null;
  const [selectedReviewInstanceId, setSelectedReviewInstanceId] = useState<string | null>(null);
  const activeReviewInstanceId = (() => {
    if (
      selectedReviewInstanceId &&
      attachedReviews.some((review) => review.id === selectedReviewInstanceId)
    ) {
      return selectedReviewInstanceId;
    }
    return instance?.reviewInstanceId ?? attachedReview?.id ?? null;
  })();
  const resolvedInstance =
    instance && activeReviewInstanceId && instance.reviewInstanceId !== activeReviewInstanceId
      ? { ...instance, reviewInstanceId: activeReviewInstanceId }
      : instance;
  const planChild = resolvedInstance?.sessionId
    ? instances.find((i) => i.parentSessionId === resolvedInstance.sessionId)
    : undefined;
  const [creatingReview, setCreatingReview] = useState(false);
  const lastSubscriptionRef = useRef<{ instanceId: string; connectionId: number } | null>(null);
  // Track file state at last send, keyed by review instance ID.
  // "Re-review" shows only when source files have changed since the last send.
  const [sentReviewSnapshots, setSentReviewSnapshots] = useState<Map<string, string>>(new Map());

  // Combine local message-driven state with server-side status so the cancel
  // button shows even on fresh navigation or WS reconnect to an active instance.
  const isActive = isProcessing || resolvedInstance?.status === "processing";

  const markRead = useUnreadStore((s) => s.markRead);

  // Track which instance we're viewing (independent of connection).
  // useLayoutEffect so the data swap happens before the browser paints
  // — without this, the new shell renders one frame with the previous
  // chat's data still in scope, and the resulting flash to the new
  // chat's layout reads as an animation.
  useLayoutEffect(() => {
    if (!id) return;
    setInstanceId(id);
    return () => setInstanceId(null);
  }, [id, setInstanceId]);

  // Mark as read after a dwell threshold — quick click-throughs don't count
  useEffect(() => {
    if (!id) return;
    const timer = setTimeout(() => markRead(id), 1500);
    return () => clearTimeout(timer);
  }, [id, markRead]);

  useEffect(() => {
    setSelectedReviewInstanceId(null);
  }, [id]);

  useEffect(() => {
    if (
      selectedReviewInstanceId &&
      !attachedReviews.some((review) => review.id === selectedReviewInstanceId)
    ) {
      setSelectedReviewInstanceId(null);
    }
  }, [attachedReviews, selectedReviewInstanceId]);

  // Subscribe/unsubscribe — re-runs on each new WS connection (connectionId)
  useEffect(() => {
    if (!id || connectionId === 0) return;
    const lastSubscription = lastSubscriptionRef.current;
    const isReconnectForSameChat =
      !!lastSubscription &&
      lastSubscription.instanceId === id &&
      lastSubscription.connectionId !== connectionId;
    const replayCursor = isReconnectForSameChat ? getReplayCursor(id) : undefined;
    subscribe(id, replayCursor?.lastSeenSequence, replayCursor?.replayEpoch);
    lastSubscriptionRef.current = { instanceId: id, connectionId };
    return () => unsubscribe(id);
  }, [id, connectionId, subscribe, unsubscribe, getReplayCursor]);

  // Register message handler
  useEffect(() => {
    if (!id) return;
    const handler = (message: ServerMessage) => {
      handleMessage(id, message);
    };
    return addMessageHandler(handler);
  }, [id, handleMessage, addMessageHandler]);

  // Navigate away if instance doesn't exist (skip in compact/split mode — parent handles it)
  useEffect(() => {
    if (compact) return;
    if (
      isConnected &&
      !isSyncing &&
      instances.length > 0 &&
      id &&
      !resolvedInstance &&
      !isFetchingSummary &&
      hasFetchedSummary &&
      summaryInstance === null
    ) {
      navigate({ to: "/", replace: true });
    }
  }, [
    compact,
    hasFetchedSummary,
    id,
    resolvedInstance,
    instances,
    isConnected,
    isFetchingSummary,
    isSyncing,
    navigate,
    summaryInstance,
  ]);

  // Slow links can take a while to finish the WS replay handshake. Fall back to
  // the passive REST history endpoint so the chat can render before WS catches up.
  useEffect(() => {
    if (!id || !resolvedInstance || hasSyncedHistory) return;
    const timer = setTimeout(() => {
      void fetchInstanceHistory(id)
        .then((history) => {
          hydrateFromHistorySnapshot(id, history);
        })
        .catch(() => {
          // Ignore — WS replay remains the source of truth and may still arrive.
        });
    }, 1200);
    return () => clearTimeout(timer);
  }, [hasSyncedHistory, hydrateFromHistorySnapshot, id, resolvedInstance]);

  const handleSend = (text: string, images?: string[], internal?: boolean) => {
    if (!id) return;
    // Prepend terminal context if attached
    let finalText = text;
    if (terminalContexts.length > 0 && !internal) {
      const blocks = terminalContexts
        .map((c) => `<terminal_context source="${c.terminalName}">\n${c.text}\n</terminal_context>`)
        .join("\n\n");
      finalText = `${blocks}\n\n${text}`;
      clearTerminalContexts(id);
    }
    send({ type: "instance_message", instanceId: id, text: finalText, images, internal });
    showThinking();
  };

  const handleTakeover = () => {
    if (!id) return;
    send({ type: "instance_takeover", instanceId: id });
  };

  const handleCancel = () => {
    if (!id || !isActive) return;
    send({ type: "instance_cancel", instanceId: id });
  };

  const handleInterruptAndSend = () => {
    if (!id || !isActive) return;
    send({ type: "instance_interrupt_and_send", instanceId: id });
  };

  const handleSwitchProvider = async (
    targetProvider: ProviderKind,
    carryContext: boolean,
    model?: string | null,
  ): Promise<void> => {
    if (!id || !resolvedInstance || targetProvider === resolvedInstance.provider) return;

    const nextInstance = await createInstance({
      provider: targetProvider,
      name: resolvedInstance.customTitle ? resolvedInstance.name : undefined,
      workingDirectory: resolvedInstance.workingDirectory,
      spaceId: resolvedInstance.spaceId,
      runtimeMode: resolvedInstance.runtimeMode,
      model: model ?? undefined,
    });

    if (carryContext) {
      const history = await fetchInstanceHistory(id);
      const handoffPrompt = buildProviderSwitchHandoffPrompt({
        sourceProvider: resolvedInstance.provider,
        targetProvider,
        sourceName: resolvedInstance.name,
        workingDirectory: resolvedInstance.workingDirectory,
        history: history as Parameters<typeof buildProviderSwitchHandoffPrompt>[0]["history"],
        changedFiles: currentFiles,
      });
      send({
        type: "instance_message",
        instanceId: nextInstance.id,
        text: handoffPrompt,
      });
    }

    const nextRoute = getInstanceChatRoute({
      ...nextInstance,
      projectId: nextInstance.projectId ?? resolvedInstance.projectId,
      originalDirectory: nextInstance.originalDirectory ?? resolvedInstance.originalDirectory,
      spaceId: nextInstance.spaceId ?? resolvedInstance.spaceId,
    });

    await navigate({
      ...nextRoute,
    });
  };

  const handleCreateReview = async (selection: {
    scope: ReviewSessionInfo["scope"];
    provider: ProviderKind;
    model?: string;
    modelOptions?: ProviderModelOptions;
    runtimeMode?: ProviderRuntimeMode;
  }): Promise<void> => {
    if (!id || !instance) return;
    setCreatingReview(true);
    try {
      const review: ReviewSessionInfo = {
        sourceInstanceId: instance.id,
        sourceSessionId: instance.sessionId,
        sourceName: instance.name,
        scope: selection.scope,
        filePaths:
          selection.scope === "session-files"
            ? (currentFiles?.map((file) => file.path) ?? [])
            : undefined,
      };
      const created = await createInstance({
        provider: selection.provider,
        name: `Review: ${instance.name}`,
        workingDirectory: instance.workingDirectory,
        spaceId: instance.spaceId,
        runtimeMode: selection.runtimeMode,
        model: selection.model,
        modelOptions: selection.modelOptions,
        parentSessionId: instance.sessionId,
        review,
      });
      const draft = buildReviewDraft({
        sourceName: instance.name,
        review,
        touchedFiles: currentFiles,
      });
      send({ type: "instance_message", instanceId: created.id, text: draft });
      if (!isSidecarOpen || activeTab !== "review") {
        selectTab("review");
      }
      if (isMobile) {
        setSidecarMobileOpen(true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create review");
    } finally {
      setCreatingReview(false);
    }
  };

  // ── Terminal panel state ──────────────────────────────────────────
  const terminalScope: TerminalScope = useMemo(
    () =>
      instance?.spaceId
        ? { type: "space", spaceId: instance.spaceId }
        : { type: "instance", instanceId: id! },
    [instance?.spaceId, id],
  );
  const {
    isPanelOpen: isTerminalPanelOpen,
    isPanelCollapsed: isTerminalPanelCollapsed,
    openPanel: openTerminalPanel,
    closePanel: closeTerminalPanel,
    expandPanel: expandTerminalPanel,
    getTerminalsForScope,
    removeTerminalContext,
    clearTerminalContexts,
    getTerminalContexts,
  } = useTerminalStore();
  const terminalContexts = id ? getTerminalContexts(id) : [];
  const showTerminalPanel = !!terminalScope && isTerminalPanelOpen(terminalScope);
  const isTerminalCollapsed = !!terminalScope && isTerminalPanelCollapsed(terminalScope);
  const collapsedTerminalCount = isTerminalCollapsed
    ? getTerminalsForScope(terminalScope).length
    : 0;
  const { height: terminalHeight, onResizeStart: handleTerminalResizeStart } = useVerticalResize();

  // Global subscriber so terminal_created responses land in the store even
  // when the panel isn't mounted (required for the "open empty scope" flow).
  useTerminalMessages(terminalScope ?? null);

  const handleToggleTerminal = () => {
    if (showTerminalPanel) {
      closeTerminalPanel();
      return;
    }
    // Opening: ensure a terminal exists in this scope before flipping pref,
    // since visibility is gated on (pref === visible && scope has terminals).
    if (terminalScope && getTerminalsForScope(terminalScope).length === 0) {
      send({ type: "terminal_create", scope: terminalScope, ifEmpty: true });
    }
    openTerminalPanel();
  };

  // Ctrl+` keyboard shortcut to toggle terminal (skip in compact mode —
  // compact InstanceViews never render the terminal panel; the parent
  // space page owns the shortcut instead).
  useTerminalShortcut(compact ? null : handleToggleTerminal);

  const isMobile = useMediaQuery("(max-width: 768px)");
  const [approvedTools, setApprovedTools] = useState<Set<string>>(new Set());
  const [showDebugPaste, setShowDebugPaste] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dismissedBranchChangeKey, setDismissedBranchChangeKey] = useState<string | null>(null);
  const connectionBanner = useConnectionBanner({
    isConnected,
    connectionId,
    isActive,
    isSyncing,
    isExternal: !!resolvedInstance?.external,
    isStopped: resolvedInstance?.status === "stopped",
    isLoadingSession: connectionId > 0 && !hasLoadedHistory,
    onContinue: handleTakeover,
    onRetry: reconnectNow,
  });

  const hasStats =
    !!resolvedInstance?.stats &&
    (resolvedInstance.stats.inputTokens > 0 || resolvedInstance.stats.outputTokens > 0);
  const tasksCount = currentTasks?.length ?? 0;
  const filesCount = currentFiles?.length ?? 0;
  const hasTasksContent = tasksCount > 0;
  const hasFilesContent = filesCount > 0;
  const hasPlanContent = !!resolvedInstance?.planContent;
  const hasReviewContent = !!resolvedInstance?.reviewInstanceId || hasFilesContent;
  const branchChangeKey = resolvedInstance?.branchChanged
    ? `${resolvedInstance.branchChanged.originalBranch}->${resolvedInstance.branchChanged.currentBranch}`
    : null;
  const showBranchChangeBanner = !!branchChangeKey && dismissedBranchChangeKey !== branchChangeKey;

  useEffect(() => {
    if (!branchChangeKey) {
      setDismissedBranchChangeKey(null);
    }
  }, [branchChangeKey]);

  const {
    activeTab,
    isOpen: isSidecarOpen,
    effectiveTab,
    selectTab,
    closeSidecar,
    mobileOpen: sidecarMobileOpen,
    setMobileOpen: setSidecarMobileOpen,
    sidecarContentCount,
    allContentPanels,
    showDesktopSidecar,
  } = useSidecarPanels({
    scope: "chat",
    isMobile,
    hasTasksContent,
    hasFilesContent,
    hasPlanContent,
    hasReviewContent,
    hasStats,
    contentLoading: connectionId > 0 && !hasLoadedHistory,
  });

  const storedSidebarWidth = useSidecarStore((s) => s.sidebarWidth);
  const setStoredSidebarWidth = useSidecarStore((s) => s.setSidebarWidth);
  const {
    panelRef: sidecarRef,
    containerRef,
    width: sidecarWidth,
    isResizing,
    onResizeStart: handleResizeStart,
  } = useResizablePanel({
    side: "right",
    minWidth: 280,
    maxWidth: (cw) => cw * 0.45,
    defaultWidth: storedSidebarWidth,
    onResizeEnd: setStoredSidebarWidth,
  });

  const handleRespondToRequest = (
    requestId: string,
    tool: string,
    decision: "accept" | "decline" = "accept",
    text?: string,
  ) => {
    if (!id) return;
    send({
      type: "respond_to_request",
      instanceId: id,
      requestId,
      decision,
      ...(text ? { text } : {}),
    });
    showThinking();
    if (decision !== "accept") return;
    setApprovedTools((prev) => {
      if (prev.has(tool)) return prev;
      const next = new Set(prev);
      next.add(tool);
      return next;
    });
  };

  const handleAnswerUserInput = (requestId: string, answers: Record<string, UserInputAnswer>) => {
    if (!id) return;
    send({
      type: "respond_to_request",
      instanceId: id,
      requestId,
      decision: "accept",
      answers,
    });
    showThinking();
  };

  const handleApproveTool = (tool: string) => {
    if (!id) return;
    const pendingRequest =
      resolvedInstance?.pendingPermission && resolvedInstance.pendingPermission.tool === tool
        ? resolvedInstance.pendingPermission
        : null;
    handleRespondToRequest(pendingRequest?.requestId ?? tool, tool);
  };

  if (!resolvedInstance) {
    const showLoadingState =
      !id || connectionId === 0 || isSyncing || isFetchingSummary || !isConnected;
    if (showLoadingState) {
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
          <div className="flex w-full max-w-md flex-col items-center px-6 py-8 text-center">
            <p className="text-[0.875rem] font-medium text-text-bright">Loading chat</p>
            <p className="mt-1 text-[0.75rem] text-muted">
              Restoring this chat after reconnecting to Relay.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
        <div className="flex w-full max-w-md flex-col items-center gap-3 px-6 py-8 text-center">
          <div>
            <p className="text-[0.875rem] font-medium text-text-bright">Chat unavailable</p>
            <p className="mt-1 text-[0.75rem] text-muted">
              Relay could not restore this chat from the live session list. Try refreshing the
              summary view and reconnecting.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void refetchSummary();
            }}
            className="inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  const instanceId = id!;

  const isStopped = resolvedInstance.status === "stopped";
  const pendingTerminalTool = resolvedInstance.pendingTool ?? null;
  const rawPermission = resolvedInstance.pendingPermission ?? null;
  const pendingPermissionTool = rawPermission
    ? typeof rawPermission === "string"
      ? rawPermission
      : rawPermission.tool
    : null;
  const pendingPermissionRequestId =
    rawPermission && typeof rawPermission === "object" ? rawPermission.requestId : null;
  const pendingPermissionDesc =
    rawPermission && typeof rawPermission === "object" ? rawPermission.description : undefined;
  const isPendingApproval =
    rawPermission && typeof rawPermission === "object" ? rawPermission.kind === "approval" : false;
  const pendingApprovalRequest =
    rawPermission && typeof rawPermission === "object" && rawPermission.kind === "approval"
      ? rawPermission
      : null;
  const pendingUserInput =
    rawPermission && typeof rawPermission === "object" && rawPermission.kind === "user_input"
      ? rawPermission
      : null;
  const pendingTerminalInput =
    rawPermission &&
    typeof rawPermission === "object" &&
    rawPermission.kind === "terminal_input" &&
    (resolvedInstance.status === "processing" ||
      resolvedInstance.providerStatus?.turnStatus === "inProgress")
      ? rawPermission
      : null;
  const isLoadingSession = connectionId > 0 && !hasLoadedHistory;
  const handleSelectReview = (reviewInstanceId: string) => {
    if (!resolvedInstance || resolvedInstance.reviewInstanceId === reviewInstanceId) return;
    setSelectedReviewInstanceId(reviewInstanceId);
    send({ type: "set_review_instance", instanceId: resolvedInstance.id, reviewInstanceId });
  };
  const handleSendReviewToChat = (reviewInstanceId: string) => {
    if (!resolvedInstance) return;
    const reviewInstance = instances.find((i) => i.id === reviewInstanceId);
    if (
      !reviewInstance?.lastMessage?.text?.trim() ||
      reviewInstance.lastMessage.from !== "assistant"
    ) {
      toast.error("No review findings to send");
      return;
    }
    const attributed = buildReviewSendBackMessage({
      reviewName: reviewInstance.name,
      sourceName: resolvedInstance.name,
      message: reviewInstance.lastMessage.text,
    });
    send({ type: "instance_message", instanceId: resolvedInstance.id, text: attributed });
    setSentReviewSnapshots((prev) =>
      new Map(prev).set(reviewInstanceId, filesFingerprint(currentFiles)),
    );
    toast.success("Review findings sent to chat");
  };

  const handleReReview = (reviewInstanceId: string) => {
    setSentReviewSnapshots((prev) => {
      const next = new Map(prev);
      next.delete(reviewInstanceId);
      return next;
    });
    send({
      type: "instance_message",
      instanceId: reviewInstanceId,
      text: "Run another review pass. Re-examine the current state of all files for new issues, resolved issues, and any regressions.",
    });
  };

  const contextValue = {
    shared: {
      id: instanceId,
      compact: !!compact,
      instance: resolvedInstance,
      embeddedSourceChat,
      attachedReviews,
      planChild,
      items,
      rawHistory,
      searchFocus,
      currentTasks,
      currentFiles,
      lastActivity,
      processingStartedAt,
      isConnected,
      isSyncing,
      isActive,
      hasLoadedHistory,
      showThinkingIndicator,
      isMobile,
      isStopped,
      hasStats,
      hasTasksContent,
      hasFilesContent,
      tasksCount,
      filesCount,
      hasPlanContent,
      showDesktopSidecar,
      activeTab,
      isSidecarOpen,
      effectiveTab,
      allContentPanels,
      sidecarMobileOpen,
      sidecarContentCount,
      sidecarWidth,
      isResizing,
      showTerminalPanel,
      isTerminalCollapsed,
      collapsedTerminalCount,
      terminalScope,
      terminalHeight,
      terminalContexts,
      pendingUserInput,
      pendingTerminalInput,
      isPendingApproval,
      pendingApprovalRequest,
      pendingPermissionTool: pendingPermissionTool ?? null,
      pendingPermissionRequestId: pendingPermissionRequestId ?? null,
      pendingPermissionDesc,
      pendingTerminalTool,
      approvedTools,
      showDebugPaste,
      confirmDelete,
      isLoadingSession,
      showBranchChangeBanner,
      branchChangeKey,
      connectionBanner,
      containerRef,
      sidecarRef,
    },
    actions: {
      navigateToSplitPicker: () => navigate({ search: { split: "pick" } }),
      navigateAfterDelete: () =>
        navigate({
          to: "/projects/$projectId/chats",
          params: { projectId: getInstanceProjectRouteId(resolvedInstance) },
        }),
      sendRemoveInstance: () => send({ type: "remove_instance", instanceId: resolvedInstance.id }),
      handleRename: (name: string) =>
        send({ type: "rename_instance", instanceId: resolvedInstance.id, name }),
      handleSend,
      handleAnswerUserInput,
      handleTakeover,
      handleCancel,
      handleInterruptAndSend,
      handleSwitchProvider,
      setShowDebugPaste,
      setConfirmDelete,
      handleRespondToRequest,
      handleApproveTool,
      dismissBranchChangeBanner: () => setDismissedBranchChangeKey(branchChangeKey),
      selectTab,
      closeSidecar,
      setSidecarMobileOpen,
      handleToggleTerminal,
      handleCreateReview,
      isCreatingReview: creatingReview,
      handleSelectReview,
      handleSendReviewToChat,
      handleReReview,
      showReReview: !!(
        activeReviewInstanceId &&
        sentReviewSnapshots.has(activeReviewInstanceId) &&
        sentReviewSnapshots.get(activeReviewInstanceId) !== filesFingerprint(currentFiles)
      ),
      expandTerminalPanel: () => expandTerminalPanel(),
      handleTerminalResizeStart,
      handleResizeStart,
      removeTerminalContext: (attachmentId: string) =>
        removeTerminalContext(instanceId, attachmentId),
    },
  } as const;

  return (
    <InstanceViewProvider value={contextValue}>
      {/* Key on instance id so the shell remounts on chat switch — resets
          AnimatePresence, the first-paint suppression, and any other local
          layout state that would otherwise animate between chats. */}
      <InstanceViewShell key={id} />
    </InstanceViewProvider>
  );
}
