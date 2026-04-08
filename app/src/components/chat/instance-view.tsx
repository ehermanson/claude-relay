import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { InstanceViewProvider } from "@/components/chat/instance-view-context";
import { InstanceViewShell } from "@/components/chat/instance-view-shell";
import { useWSMethods, useWSState } from "@/context/websocket-context";
import { useInstanceMessages } from "@/hooks/use-instance-messages";
import { useConnectionBanner } from "@/hooks/use-connection-banner";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { useSidecarPanels } from "@/stores/sidecar-store";
import { useUnreadStore } from "@/stores/unread-store";
import { useTerminalStore, scopeKey } from "@/stores/terminal-store";
import { useTerminalShortcut } from "@/hooks/use-terminal-shortcut";
import { useVerticalResize } from "@/hooks/use-vertical-resize";
import { createInstance, fetchInstanceHistory } from "@/lib/api";
import { getInstanceChatRoute, getInstanceProjectRouteId } from "@/lib/project-route";
import { buildProviderSwitchHandoffPrompt } from "@shared/session-handoff";
import type { ServerMessage, ProviderKind, TerminalScope, UserInputAnswer } from "@shared/types";

interface InstanceViewProps {
  /** Override the instance ID instead of reading from URL params. */
  instanceId?: string;
  /** Compact mode: hide header and sidecar (used in split view). */
  compact?: boolean;
}

export function InstanceView({ instanceId: propId, compact }: InstanceViewProps = {}) {
  const { chatId: paramId } = useParams({ strict: false }) as {
    chatId?: string;
  };
  const id = propId ?? paramId;
  const navigate = useNavigate({ from: "/projects/$projectId/chats/$chatId" });
  const { send, subscribe, unsubscribe, addMessageHandler } = useWSMethods();
  const { isConnected, isSyncing, connectionId, instances } = useWSState();
  const {
    items,
    hasLoadedHistory,
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
  } = useInstanceMessages();

  const instance = instances.find((i) => i.id === id);
  const planChild = instance?.sessionId
    ? instances.find((i) => i.parentSessionId === instance.sessionId)
    : undefined;

  // Combine local message-driven state with server-side status so the cancel
  // button shows even on fresh navigation or WS reconnect to an active instance.
  const isActive = isProcessing || instance?.status === "processing";

  const markRead = useUnreadStore((s) => s.markRead);

  // Track which instance we're viewing (independent of connection)
  useEffect(() => {
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

  // Subscribe/unsubscribe — re-runs on each new WS connection (connectionId)
  useEffect(() => {
    if (!id || connectionId === 0) return;
    const replayCursor = getReplayCursor(id);
    subscribe(id, replayCursor?.lastSeenSequence, replayCursor?.replayEpoch);
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
    if (isConnected && instances.length > 0 && id && !instance) {
      navigate({ to: "/", replace: true });
    }
  }, [compact, isConnected, instances, id, instance, navigate]);

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
    if (!id || !instance || targetProvider === instance.provider) return;

    const nextInstance = await createInstance({
      provider: targetProvider,
      name: instance.customTitle ? instance.name : undefined,
      workingDirectory: instance.workingDirectory,
      spaceId: instance.spaceId,
      dangerouslySkipPermissions: instance.skipPermissions,
      model: model ?? undefined,
    });

    if (carryContext) {
      const history = await fetchInstanceHistory(id);
      const handoffPrompt = buildProviderSwitchHandoffPrompt({
        sourceProvider: instance.provider,
        targetProvider,
        sourceName: instance.name,
        workingDirectory: instance.workingDirectory,
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
      projectId: nextInstance.projectId ?? instance.projectId,
      originalDirectory: nextInstance.originalDirectory ?? instance.originalDirectory,
      spaceId: nextInstance.spaceId ?? instance.spaceId,
    });

    await navigate({
      ...nextRoute,
    });
  };

  // ── Terminal panel state ──────────────────────────────────────────
  const terminalScope: TerminalScope = useMemo(
    () =>
      instance?.spaceId
        ? { type: "space", spaceId: instance.spaceId }
        : { type: "instance", instanceId: id! },
    [instance?.spaceId, id],
  );
  const terminalScopeKey = terminalScope ? scopeKey(terminalScope) : "";
  const {
    isPanelOpen: isTerminalPanelOpen,
    isPanelCollapsed: isTerminalPanelCollapsed,
    togglePanel: toggleTerminalPanel,
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

  const handleToggleTerminal = () => {
    if (terminalScopeKey) {
      toggleTerminalPanel(terminalScopeKey);
    }
  };

  // Ctrl+` keyboard shortcut to toggle terminal (skip in compact mode —
  // compact InstanceViews never render the terminal panel; the parent
  // space page owns the shortcut instead).
  useTerminalShortcut(compact ? null : terminalScopeKey);

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
    isExternal: !!instance?.external,
    isStopped: instance?.status === "stopped",
    isLoadingSession: connectionId > 0 && !hasLoadedHistory,
    onContinue: handleTakeover,
  });

  const hasStats =
    !!instance?.stats && (instance.stats.inputTokens > 0 || instance.stats.outputTokens > 0);
  const hasTasksContent = (currentTasks?.length ?? 0) > 0;
  const hasFilesContent = (currentFiles?.length ?? 0) > 0;
  const hasPlanContent = !!instance?.planContent;
  const branchChangeKey = instance?.branchChanged
    ? `${instance.branchChanged.originalBranch}->${instance.branchChanged.currentBranch}`
    : null;
  const showBranchChangeBanner = !!branchChangeKey && dismissedBranchChangeKey !== branchChangeKey;

  useEffect(() => {
    if (!branchChangeKey) {
      setDismissedBranchChangeKey(null);
    }
  }, [branchChangeKey]);

  const {
    activePanels,
    mobileOpen: sidecarMobileOpen,
    setMobileOpen: setSidecarMobileOpen,
    togglePanel,
    sidecarContentCount,
    allContentPanels,
    showDesktopSidecar,
  } = useSidecarPanels({
    instanceId: id,
    isMobile,
    hasTasksContent,
    hasFilesContent,
    hasPlanContent,
    hasStats,
  });

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
      instance?.pendingPermission && instance.pendingPermission.tool === tool
        ? instance.pendingPermission
        : null;
    handleRespondToRequest(pendingRequest?.requestId ?? tool, tool);
  };

  if (!instance) {
    return null;
  }
  const instanceId = id!;

  const isStopped = instance.status === "stopped";
  const pendingTerminalTool = instance.pendingTool ?? null;
  const rawPermission = instance.pendingPermission ?? null;
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
    (instance.status === "processing" || instance.providerStatus?.turnStatus === "inProgress")
      ? rawPermission
      : null;
  const isLoadingSession = connectionId > 0 && !hasLoadedHistory;

  const contextValue = {
    shared: {
      id: instanceId,
      compact: !!compact,
      instance,
      planChild,
      items,
      rawHistory,
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
      hasPlanContent,
      showDesktopSidecar,
      activePanels,
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
          params: { projectId: getInstanceProjectRouteId(instance) },
        }),
      sendRemoveInstance: () => send({ type: "remove_instance", instanceId: instance.id }),
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
      togglePanel,
      setSidecarMobileOpen,
      handleToggleTerminal,
      expandTerminalPanel: () => expandTerminalPanel(terminalScopeKey),
      handleTerminalResizeStart,
      handleResizeStart,
      removeTerminalContext: (attachmentId: string) =>
        removeTerminalContext(instanceId, attachmentId),
    },
  } as const;

  return (
    <InstanceViewProvider value={contextValue}>
      <InstanceViewShell />
    </InstanceViewProvider>
  );
}
