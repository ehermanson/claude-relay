import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ConnectionStatusBanner } from "@/components/chat/connection-status-banner";
import { DebugModal } from "@/components/chat/debug-modal";
import { ExternalSessionBar } from "@/components/chat/external-session-bar";
import { InputArea } from "@/components/chat/input-area";
import { InstanceHeader } from "@/components/chat/instance-header";
import { MessageList } from "@/components/chat/message-list";
import { PermissionBanner } from "@/components/chat/permission-banner";
import { BranchChangeBanner } from "@/components/chat/branch-change-banner";
import { Sidecar } from "@/components/chat/sidecar";
import { TerminalPermissionBar } from "@/components/chat/terminal-permission-bar";
import { TerminalPanel, CollapsedTerminalBar } from "@/components/terminal/terminal-panel";
import { TerminalContextStrip } from "@/components/terminal/terminal-context-strip";
import { RelayLogo } from "@/components/ui/relay-logo";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { useWSMethods, useWSState } from "@/context/websocket-context";
import { useInstanceMessages } from "@/hooks/use-instance-messages";
import { useConnectionBanner } from "@/hooks/use-connection-banner";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { useSidecarPanels } from "@/hooks/use-sidecar-store";
import { useTerminalStore, scopeKey } from "@/hooks/use-terminal-store";
import { useVerticalResize } from "@/hooks/use-vertical-resize";
import { createInstance, fetchInstanceHistory } from "@/lib/api";
import { getInstanceChatRoute, getInstanceProjectRouteId } from "@/lib/project-route";
import { buildProviderSwitchHandoffPrompt } from "@shared/session-handoff";
import type { ServerMessage, ProviderKind, TerminalScope, UserInputAnswer } from "@shared/types";

const MotionLogo = motion.create(RelayLogo);

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

  // Track which instance we're viewing (independent of connection)
  useEffect(() => {
    if (!id) return;
    setInstanceId(id);
    return () => setInstanceId(null);
  }, [id, setInstanceId]);

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
    send({ type: "instance_message", instanceId: id, text: "Continue." });
    showThinking();
  };

  const handleCancel = () => {
    if (!id || !isActive) return;
    send({ type: "instance_cancel", instanceId: id });
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
        history,
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
  const handleToggleTerminalRef = useRef(handleToggleTerminal);
  handleToggleTerminalRef.current = handleToggleTerminal;
  useEffect(() => {
    if (compact) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "`" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleToggleTerminalRef.current();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [compact]);

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

  const handleRespondToRequest = (requestId: string, tool: string) => {
    if (!id) return;
    setApprovedTools((prev) => {
      if (prev.has(tool)) return prev;
      send({
        type: "respond_to_request",
        instanceId: id,
        requestId,
        decision: "accept",
      });
      showThinking();
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
  const pendingUserInput =
    rawPermission && typeof rawPermission === "object" && rawPermission.kind === "user_input"
      ? rawPermission
      : null;
  const isLoadingSession = connectionId > 0 && !hasLoadedHistory;

  const loadingContent = (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-md flex-col items-center px-6 py-8 text-center">
        <MotionLogo
          size={112}
          connected={isConnected}
          showPulseRings
          className="mb-5"
          initial={{ opacity: 0, scale: 0.82 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: "spring", duration: 0.9, bounce: 0.25 }}
        />
        <p className="text-[0.875rem] font-medium text-text-bright">Loading chat</p>
        <p className="mt-1 text-[0.75rem] text-muted">
          Replaying history and restoring live state for this chat.
        </p>
      </div>
    </div>
  );

  const chatContent = (
    <>
      {isLoadingSession ? (
        loadingContent
      ) : (
        <ErrorBoundary name="Message list">
          <MessageList
            key={id}
            items={items}
            isProcessing={isActive}
            showThinkingIndicator={showThinkingIndicator}
            instanceStatus={instance.status}
            lastActivity={lastActivity}
            processingStartedAt={processingStartedAt}
            onSendMessage={handleSend}
            onAnswerUserInput={handleAnswerUserInput}
            isInteractive={!isStopped}
            onApproveTool={handleApproveTool}
            approvedTools={approvedTools}
            isExternal={!!instance.sessionId}
            pendingInteraction={!!instance.pendingPlan || !!pendingUserInput}
            planChildId={planChild?.id}
            planChildName={planChild?.name}
          />
        </ErrorBoundary>
      )}
      {showDebugPaste && (
        <DebugModal
          instance={instance}
          items={items}
          isProcessing={isActive}
          onClose={() => setShowDebugPaste(false)}
        />
      )}
      <ConfirmActionDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete chat?"
        description={
          <>
            <span className="font-medium text-text">{instance.name}</span> will be permanently
            removed.
          </>
        }
        confirmLabel="Delete"
        onConfirm={() => {
          send({ type: "remove_instance", instanceId: instance.id });
          setConfirmDelete(false);
          navigate({
            to: "/projects/$projectId/chats",
            params: { projectId: getInstanceProjectRouteId(instance) },
          });
        }}
      />

      {isPendingApproval &&
        pendingPermissionTool &&
        pendingPermissionRequestId &&
        !instance.external &&
        !instance.pendingPlan && (
          <PermissionBanner
            key={pendingPermissionRequestId}
            provider={instance.provider}
            requestId={pendingPermissionRequestId}
            tool={pendingPermissionTool}
            description={pendingPermissionDesc}
            onApprove={handleRespondToRequest}
          />
        )}

      {pendingTerminalTool && !pendingUserInput && (
        <TerminalPermissionBar provider={instance.provider} pendingTool={pendingTerminalTool} />
      )}

      {connectionBanner && (
        <ConnectionStatusBanner
          kind={connectionBanner.kind}
          onContinue={connectionBanner.onContinue}
          onDismiss={connectionBanner.onDismiss}
        />
      )}

      {!isLoadingSession && showBranchChangeBanner && instance.branchChanged && (
        <BranchChangeBanner
          originalBranch={instance.branchChanged.originalBranch}
          currentBranch={instance.branchChanged.currentBranch}
          onDismiss={() => setDismissedBranchChangeKey(branchChangeKey)}
        />
      )}

      {!isLoadingSession &&
        (instance.external ? (
          <ExternalSessionBar
            isStopped={isStopped}
            isConnected={isConnected}
            onTakeover={handleTakeover}
            provider={instance.provider}
            model={instance.stats?.model}
          />
        ) : (
          <ErrorBoundary name="Input area" inline>
            <InputArea
              onSend={handleSend}
              onAnswerUserInput={handleAnswerUserInput}
              onCancel={handleCancel}
              onSwitchProvider={handleSwitchProvider}
              isProcessing={isActive}
              isConnected={isConnected}
              instanceId={id!}
              isStopped={isStopped}
              provider={instance.provider}
              preferredModel={instance.preferredModel}
              reasoningBudget={instance.reasoningBudget}
              modelOptions={instance.modelOptions}
              planMode={instance.planMode}
              activeModel={instance.stats?.model}
              skipPermissions={instance.skipPermissions}
              hasMessages={items.length > 0}
              pendingUserInput={pendingUserInput}
              pendingPlan={instance.pendingPlan}
              topSlot={
                <TerminalContextStrip
                  attachments={terminalContexts}
                  onRemove={(attachmentId) => id && removeTerminalContext(id, attachmentId)}
                />
              }
            />
          </ErrorBoundary>
        ))}
    </>
  );

  if (compact) {
    return (
      <div className="flex h-full flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col">{chatContent}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <InstanceHeader
        instance={instance}
        isMobile={isMobile}
        activePanels={activePanels}
        hasTasksContent={hasTasksContent}
        hasFilesContent={hasFilesContent}
        hasPlanContent={hasPlanContent}
        hasStats={hasStats}
        sidecarContentCount={sidecarContentCount}
        loadingSidecarActions={isLoadingSession}
        onTogglePanel={togglePanel}
        onOpenDebug={() => setShowDebugPaste(true)}
        onDelete={() => setConfirmDelete(true)}
        onOpenMobileSidecar={() => setSidecarMobileOpen(true)}
        onSplit={() => navigate({ search: { split: "pick" } })}
        onToggleTerminal={handleToggleTerminal}
        terminalOpen={showTerminalPanel || isTerminalCollapsed}
      />

      <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{chatContent}</div>
          {showTerminalPanel && !isMobile && (
            <ErrorBoundary name="Terminal panel">
              <TerminalPanel
                scope={terminalScope}
                height={terminalHeight}
                onResizeStart={handleTerminalResizeStart}
                activeInstanceId={id}
              />
            </ErrorBoundary>
          )}
          {isTerminalCollapsed && !isMobile && collapsedTerminalCount > 0 && (
            <CollapsedTerminalBar
              terminalCount={collapsedTerminalCount}
              onExpand={() => expandTerminalPanel(terminalScopeKey)}
            />
          )}
        </div>
        {!isMobile && (
          <div
            className={`relative flex h-full shrink-0 overflow-hidden ${
              isResizing ? "" : "transition-[width,opacity] duration-200 ease-out"
            } ${showDesktopSidecar ? "opacity-100" : "w-0 opacity-0"}`}
            ref={sidecarRef}
            style={showDesktopSidecar ? { width: sidecarWidth ?? "max(280px, 30%)" } : undefined}
          >
            {/* Resize handle */}
            <div
              onMouseDown={handleResizeStart}
              className="absolute inset-y-0 left-0 z-10 w-px cursor-col-resize bg-border/50 after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 after:content-['']"
            />
            <div className="h-full flex-1 pl-px">
              <ErrorBoundary name="Sidecar">
                <Sidecar
                  tasks={currentTasks}
                  files={currentFiles}
                  planContent={instance.planContent}
                  stats={instance.stats}
                  items={items}
                  rawHistory={rawHistory}
                  provider={instance.provider}
                  preferredModel={instance.preferredModel}
                  instanceId={id}
                  createdAt={instance.createdAt}
                  lastActivityAt={instance.lastActivityAt}
                  workingDirectory={instance.workingDirectory}
                  activePanels={activePanels}
                />
              </ErrorBoundary>
            </div>
          </div>
        )}
      </div>
      {isMobile && sidecarMobileOpen && sidecarContentCount > 0 && (
        <ErrorBoundary name="Sidecar">
          <Sidecar
            tasks={currentTasks}
            files={currentFiles}
            planContent={instance.planContent}
            stats={instance.stats}
            items={items}
            rawHistory={rawHistory}
            provider={instance.provider}
            preferredModel={instance.preferredModel}
            instanceId={id}
            createdAt={instance.createdAt}
            lastActivityAt={instance.lastActivityAt}
            workingDirectory={instance.workingDirectory}
            activePanels={allContentPanels}
            onClose={() => setSidecarMobileOpen(false)}
            isMobileOverlay
          />
        </ErrorBoundary>
      )}
    </div>
  );
}
