import { useEffect, useState } from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Group, Panel } from "react-resizable-panels";
import { useWSMethods, useWSState } from "../../context/websocket-context";
import { useInstanceMessages } from "../../hooks/use-instance-messages";
import { useMediaQuery } from "../../hooks/use-media-query";
import { useSidecarPanels } from "../../hooks/use-sidecar-panels";
import { MessageList } from "./message-list";
import { ExternalSessionBar } from "./external-session-bar";
import { InputArea } from "./input-area";
import { Sidecar } from "./sidecar";
import { ResizableHandle } from "../ui/resizable-handle";
import { RelayLogo } from "../ui/relay-logo";
import { PermissionBanner } from "./permission-banner";
import { MergeBanner } from "./merge-banner";
import { DebugModal } from "./debug-modal";
import { TerminalPermissionBar } from "./terminal-permission-bar";
import { InstanceHeader } from "./instance-header";
import { createInstance, fetchInstanceHistory } from "../../lib/api";
import { buildProviderSwitchHandoffPrompt } from "@shared/session-handoff";
import type { ServerMessage, ProviderKind } from "@shared/types";

const MotionLogo = motion.create(RelayLogo);

interface InstanceViewProps {
  /** Override the instance ID instead of reading from URL params. */
  instanceId?: string;
  /** Compact mode: hide header and sidecar (used in split view). */
  compact?: boolean;
}

export function InstanceView({ instanceId: propId, compact }: InstanceViewProps = {}) {
  const { chatId: paramId, projectId } = useParams({ strict: false }) as {
    chatId?: string;
    projectId?: string;
  };
  const id = propId ?? paramId;
  const navigate = useNavigate();
  const { send, subscribe, unsubscribe, addMessageHandler } = useWSMethods();
  const { isConnected, connectionId, instances } = useWSState();

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
    handleMessage,
    setInstanceId,
    showThinking,
  } = useInstanceMessages();

  const instance = instances.find((i) => i.id === id);
  const planChild = instance?.sessionId
    ? instances.find((i) => i.parentSessionId === instance.sessionId)
    : undefined;

  // Track which instance we're viewing (independent of connection)
  useEffect(() => {
    if (!id) return;
    setInstanceId(id);
    return () => setInstanceId(null);
  }, [id, setInstanceId]);

  // Subscribe/unsubscribe — re-runs on each new WS connection (connectionId)
  useEffect(() => {
    if (!id || connectionId === 0) return;
    subscribe(id);
    return () => unsubscribe(id);
  }, [id, connectionId, subscribe, unsubscribe]);

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

  const handleSend = (text: string, images?: string[]) => {
    if (!id) return;
    send({ type: "instance_message", instanceId: id, text, images });
    showThinking();
  };

  const handleTakeover = () => {
    if (!id) return;
    send({ type: "instance_message", instanceId: id, text: "Continue." });
    showThinking();
  };

  const handleCancel = () => {
    if (!id || !isProcessing) return;
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
      dangerouslySkipPermissions: instance.skipPermissions ?? false,
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

    await navigate({
      to: "/projects/$projectId/chats/$chatId",
      params: {
        projectId:
          projectId || instance.workingDirectory.split("/").pop() || instance.workingDirectory,
        chatId: nextInstance.id,
      },
    });
  };

  const isMobile = useMediaQuery("(max-width: 768px)");
  const [approvedTools, setApprovedTools] = useState<Set<string>>(new Set());
  const [showDebugPaste, setShowDebugPaste] = useState(false);

  const hasStats =
    !!instance?.stats && (instance.stats.inputTokens > 0 || instance.stats.outputTokens > 0);
  const hasTasksContent = (currentTasks?.length ?? 0) > 0;
  const hasFilesContent = (currentFiles?.length ?? 0) > 0;

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
    hasStats,
  });

  const handleMerge = () => {
    if (!id) return;
    send({ type: "merge_instance", instanceId: id });
  };

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
        <MessageList
          key={id}
          items={items}
          isProcessing={isProcessing}
          showThinkingIndicator={showThinkingIndicator}
          instanceStatus={instance.status}
          lastActivity={lastActivity}
          processingStartedAt={processingStartedAt}
          onSendMessage={handleSend}
          isInteractive={!isStopped}
          onApproveTool={handleApproveTool}
          approvedTools={approvedTools}
          isExternal={!!instance.sessionId}
          planChildId={planChild?.id}
          planChildName={planChild?.name}
        />
      )}
      {showDebugPaste && (
        <DebugModal
          instance={instance}
          items={items}
          isProcessing={isProcessing}
          onClose={() => setShowDebugPaste(false)}
        />
      )}

      {pendingPermissionTool && pendingPermissionRequestId && !instance.external && (
        <PermissionBanner
          key={pendingPermissionRequestId}
          provider={instance.provider}
          requestId={pendingPermissionRequestId}
          tool={pendingPermissionTool}
          description={pendingPermissionDesc}
          onApprove={handleRespondToRequest}
        />
      )}

      {pendingTerminalTool && (
        <TerminalPermissionBar provider={instance.provider} pendingTool={pendingTerminalTool} />
      )}

      {instance.gitBranch &&
        instance.hasChanges &&
        instance.status === "idle" &&
        !instance.external &&
        items.length > 0 && <MergeBanner onMerge={handleMerge} />}

      {!isLoadingSession &&
        (instance.external ? (
          <ExternalSessionBar
            isStopped={isStopped}
            isConnected={isConnected}
            onTakeover={handleTakeover}
          />
        ) : (
          <InputArea
            onSend={handleSend}
            onCancel={handleCancel}
            onSwitchProvider={handleSwitchProvider}
            isProcessing={isProcessing}
            isConnected={isConnected}
            instanceId={id!}
            sessionId={instance.sessionId}
            isStopped={isStopped}
            isPendingInTerminal={!!pendingTerminalTool}
            provider={instance.provider}
            preferredModel={instance.preferredModel}
            reasoningBudget={instance.reasoningBudget}
            planMode={instance.planMode}
            activeModel={instance.stats?.model}
            skipPermissions={instance.skipPermissions}
            hasMessages={items.length > 0}
          />
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
        hasStats={hasStats}
        sidecarContentCount={sidecarContentCount}
        onTogglePanel={togglePanel}
        onOpenDebug={() => setShowDebugPaste(true)}
        onOpenMobileSidecar={() => setSidecarMobileOpen(true)}
        onSplit={() => navigate({ search: { split: "pick" } })}
      />

      {showDesktopSidecar ? (
        <Group orientation="horizontal" className="min-h-0 flex-1">
          <Panel defaultSize="70" minSize="40">
            <div className="flex h-full min-w-0 flex-col overflow-hidden">{chatContent}</div>
          </Panel>
          <ResizableHandle />
          <Panel defaultSize="30" minSize="15" maxSize="45">
            <Sidecar
              tasks={currentTasks}
              files={currentFiles}
              stats={instance.stats}
              items={items}
              rawHistory={rawHistory}
              provider={instance.provider}
              preferredModel={instance.preferredModel}
              instanceName={instance.name}
              instanceId={id}
              createdAt={instance.createdAt}
              lastActivityAt={instance.lastActivityAt}
              workingDirectory={instance.workingDirectory}
              activePanels={activePanels}
            />
          </Panel>
        </Group>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col">{chatContent}</div>
        </div>
      )}
      {isMobile && sidecarMobileOpen && sidecarContentCount > 0 && (
        <Sidecar
          tasks={currentTasks}
          files={currentFiles}
          stats={instance.stats}
          items={items}
          rawHistory={rawHistory}
          provider={instance.provider}
          preferredModel={instance.preferredModel}
          instanceName={instance.name}
          instanceId={id}
          createdAt={instance.createdAt}
          lastActivityAt={instance.lastActivityAt}
          workingDirectory={instance.workingDirectory}
          activePanels={allContentPanels}
          onClose={() => setSidecarMobileOpen(false)}
          isMobileOverlay
        />
      )}
    </div>
  );
}
