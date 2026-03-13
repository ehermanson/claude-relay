import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Group, Panel } from "react-resizable-panels";
import { useWSMethods, useWSState } from "../../context/websocket-context";
import { useInstanceMessages } from "../../hooks/use-instance-messages";
import { useMediaQuery } from "../../hooks/use-media-query";
import { MessageList } from "./message-list";
import { InputArea } from "./input-area";
import { Sidecar, type SidecarTab } from "./sidecar";
import { ResizableHandle } from "../ui/resizable-handle";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { RelayLogo } from "../ui/relay-logo";
import { Tooltip } from "../ui/tooltip";
import { OpenInMenu } from "../project/open-in-menu";
import { PermissionBanner } from "./permission-banner";
import { MergeBanner } from "./merge-banner";
import { Bug, ChevronLeft, FileText, GitBranch, LayoutGrid, ListChecks } from "lucide-react";
import { ContextRing } from "./input-area/shared";
import { shortenPath, formatTokens, formatCost } from "../../lib/utils";
import { createInstance, fetchInstanceHistory } from "../../lib/api";
import { buildProviderSwitchHandoffPrompt } from "@shared/session-handoff";
import type { ServerMessage } from "@shared/types";

import type { InstanceInfo, ProviderKind } from "@shared/types";
import type { ChatItem } from "../../hooks/use-instance-messages";

const MotionLogo = motion.create(RelayLogo);

function DebugModal({
  instance,
  items,
  isProcessing,
  onClose,
}: {
  instance: InstanceInfo;
  items: ChatItem[];
  isProcessing: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const debugDump = JSON.stringify({ instance, items, isProcessing }, null, 2);

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
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Debug</Dialog.Title>
          <Dialog.Close />
        </Dialog.Header>
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

export function InstanceView() {
  const { chatId: id, projectId } = useParams({ strict: false }) as {
    chatId?: string;
    projectId?: string;
  };
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
  // rather than on isConnected, so re-subscription fires even during the
  // disconnect grace period.
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

  // Navigate away if instance doesn't exist
  useEffect(() => {
    if (isConnected && instances.length > 0 && id && !instance) {
      navigate({ to: "/", replace: true });
    }
  }, [isConnected, instances, id, instance, navigate]);

  const [takeoverPending, setTakeoverPending] = useState<{
    text: string;
    images?: string[];
  } | null>(null);

  const handleSend = (text: string, images?: string[]) => {
    if (!id) return;
    // If this is an external session, confirm before taking over
    if (instance?.external) {
      setTakeoverPending({ text, images });
      return;
    }
    send({ type: "instance_message", instanceId: id, text, images });
    showThinking();
  };

  const confirmTakeover = () => {
    if (!id || !takeoverPending) return;
    send({
      type: "instance_message",
      instanceId: id,
      text: takeoverPending.text,
      images: takeoverPending.images,
    });
    showThinking();
    setTakeoverPending(null);
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
  const [sidecarMobileOpen, setSidecarMobileOpen] = useState(false);

  // --- Sidecar panel toggles ---
  const [activePanels, setActivePanels] = useState<Set<SidecarTab>>(new Set());
  const manuallyToggledOff = useRef(new Set<SidecarTab>());
  const prevHasTasksRef = useRef(false);
  const prevHasFilesRef = useRef(false);

  const togglePanel = useCallback((panel: SidecarTab) => {
    setActivePanels((prev) => {
      const next = new Set(prev);
      if (next.has(panel)) {
        next.delete(panel);
        manuallyToggledOff.current.add(panel);
      } else {
        next.add(panel);
        manuallyToggledOff.current.delete(panel);
      }
      return next;
    });
  }, []);

  // Reset when switching instances
  useEffect(() => {
    setSidecarMobileOpen(false);
    setActivePanels(new Set());
    manuallyToggledOff.current.clear();
    prevHasTasksRef.current = false;
    prevHasFilesRef.current = false;
  }, [id]);

  const hasStats =
    !!instance?.stats && (instance.stats.inputTokens > 0 || instance.stats.outputTokens > 0);

  // Per-panel content flags
  const hasTasksContent = (currentTasks?.length ?? 0) > 0;
  const hasFilesContent = (currentFiles?.length ?? 0) > 0;

  // Auto-activate operational panels when content first appears (skip if user manually toggled off)
  useEffect(() => {
    const toActivate: SidecarTab[] = [];
    if (hasTasksContent && !prevHasTasksRef.current && !manuallyToggledOff.current.has("tasks"))
      toActivate.push("tasks");
    if (hasFilesContent && !prevHasFilesRef.current && !manuallyToggledOff.current.has("files"))
      toActivate.push("files");
    prevHasTasksRef.current = hasTasksContent;
    prevHasFilesRef.current = hasFilesContent;
    if (toActivate.length > 0) {
      setActivePanels((prev) => {
        const next = new Set(prev);
        for (const tab of toActivate) next.add(tab);
        return next;
      });
    }
  }, [hasTasksContent, hasFilesContent]);

  // Total content for mobile sidecar button badge
  const sidecarContentCount =
    (currentTasks?.length ?? 0) + (currentFiles?.length ?? 0) + (hasStats ? 1 : 0);

  // All panels with content — used for mobile overlay (shows everything)
  const allContentPanels = useMemo(() => {
    const s = new Set<SidecarTab>();
    if (hasTasksContent) s.add("tasks");
    if (hasFilesContent) s.add("files");
    if (hasStats) s.add("context");
    return s;
  }, [hasTasksContent, hasFilesContent, hasStats]);

  // Desktop sidecar visible when any active panel has content
  const showDesktopSidecar =
    !isMobile &&
    ((activePanels.has("tasks") && hasTasksContent) ||
      (activePanels.has("files") && hasFilesContent) ||
      (activePanels.has("context") && hasStats));

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

  // Server tracks pendingTool on InstanceInfo — no client-side scanning needed
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

      {/* Takeover confirmation for external sessions */}
      <Dialog.Root open={!!takeoverPending} onOpenChange={() => setTakeoverPending(null)}>
        <Dialog.Content maxWidth="max-w-md">
          <Dialog.Title>Take over terminal chat?</Dialog.Title>
          <p className="text-sm text-muted">
            This will stop the Claude process running in your terminal and continue the chat here in
            Relay. You won't be able to resume it in the terminal afterward.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTakeoverPending(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmTakeover}>
              Take over
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Root>

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
        <div className="animate-fade-in shrink-0 border-t border-warning/25 bg-warning/5">
          <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/15">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-warning"
              >
                <path d="M4 17l6-6-6-6" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] font-medium text-warning">
                Waiting for your response in the terminal
              </p>
              <p className="text-[0.75rem] text-muted">
                {instance.provider === "codex" ? "Codex" : "Claude"} is waiting for approval to use{" "}
                {pendingTerminalTool}. Switch to your terminal to respond.
              </p>
            </div>
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-pulse-dot rounded-full bg-warning opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-warning" />
            </span>
          </div>
        </div>
      )}

      {instance.gitBranch &&
        instance.hasChanges &&
        instance.status === "idle" &&
        !instance.external &&
        items.length > 0 && <MergeBanner onMerge={handleMerge} />}

      {!isLoadingSession && (
        <InputArea
          onSend={handleSend}
          onCancel={handleCancel}
          onSwitchProvider={handleSwitchProvider}
          isProcessing={isProcessing}
          isConnected={isConnected}
          instanceId={id!}
          sessionId={instance.sessionId}
          isStopped={isStopped}
          isExternal={!!instance.external}
          isPendingInTerminal={!!pendingTerminalTool}
          provider={instance.provider}
          preferredModel={instance.preferredModel}
          reasoningBudget={instance.reasoningBudget}
          planMode={instance.planMode}
          activeModel={instance.stats?.model}
          skipPermissions={instance.skipPermissions}
          hasMessages={items.length > 0}
        />
      )}
    </>
  );

  // Status dot + label
  let dotClass: string;
  let statusLabel: string;
  if (isStopped) {
    dotClass = "bg-muted";
    statusLabel = instance.external ? "External chat (ended)" : "Ended";
  } else if (instance.status === "processing") {
    dotClass = "animate-pulse-dot bg-warning";
    statusLabel = instance.external ? "External chat (active)" : "Processing";
  } else if (instance.external) {
    dotClass = "bg-accent";
    statusLabel = "External chat";
  } else {
    dotClass = "bg-accent";
    statusLabel = "Idle";
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-2.5">
        <Tooltip content="Back">
          <Link
            to="/projects/$projectId/chats"
            params={{
              projectId: instance.workingDirectory.split("/").pop() || "",
            }}
            className="hidden h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text max-[768px]:flex"
          >
            <ChevronLeft size={16} strokeWidth={2} />
          </Link>
        </Tooltip>
        {/* Title area with inline status dot */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Tooltip content={statusLabel}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
            </Tooltip>
            <h1 className="truncate text-sm font-semibold tracking-tight text-text-bright">
              {instance.name}
            </h1>
          </div>
          {/* Metadata line: project · branch · tokens */}
          <div className="hidden items-center gap-1 pl-4 text-[0.6875rem] text-muted sm:flex">
            <Tooltip content={instance.workingDirectory} side="bottom">
              <Link
                to="/projects/$projectId/chats"
                params={{
                  projectId:
                    instance.workingDirectory.split("/").pop() || instance.workingDirectory,
                }}
                className="truncate transition-colors hover:text-accent"
              >
                {instance.workingDirectory.split("/").pop() || instance.workingDirectory}
              </Link>
            </Tooltip>
            {(instance.gitBranch || instance.gitInfo?.branch) && (
              <>
                <span className="text-border">·</span>
                <Tooltip
                  content={
                    instance.gitBranch
                      ? `Working in worktree on branch ${instance.gitBranch}${instance.originalDirectory ? ` (from ${instance.originalDirectory})` : ""}`
                      : `On branch ${instance.gitInfo!.branch}`
                  }
                >
                  <span className="flex shrink-0 items-center gap-1 text-accent/70">
                    <GitBranch size={10} strokeWidth={2.5} />
                    {instance.gitBranch || instance.gitInfo!.branch}
                  </span>
                </Tooltip>
              </>
            )}
            {instance.stats && instance.stats.costUSD > 0 && (
              <>
                <span className="text-border">·</span>
                <Tooltip
                  content={
                    <div className="flex flex-col gap-0.5">
                      <div className="font-medium">{instance.stats.model ?? "Unknown model"}</div>
                      <div>Input: {formatTokens(instance.stats.inputTokens)}</div>
                      <div>Output: {formatTokens(instance.stats.outputTokens)}</div>
                      <div>Cache write: {formatTokens(instance.stats.cacheCreationTokens)}</div>
                      <div>Cache read: {formatTokens(instance.stats.cacheReadTokens)}</div>
                    </div>
                  }
                >
                  <span className="shrink-0">
                    {formatTokens(instance.stats.inputTokens + instance.stats.outputTokens)} tokens
                    · ~{formatCost(instance.stats.costUSD)}
                  </span>
                </Tooltip>
              </>
            )}
          </div>
        </div>
        {/* Action buttons: [Open in X] | [Debug] | [Sidecar Controls] */}
        <div className="flex items-center gap-1">
          <OpenInMenu path={instance.workingDirectory} className="hidden sm:flex" />
          <Tooltip content="Debug chat data">
            <Button variant="icon" onClick={() => setShowDebugPaste(true)} className="shrink-0">
              <Bug size={15} strokeWidth={2} />
            </Button>
          </Tooltip>
          {/* Desktop: per-panel toggle buttons (only shown when content exists) */}
          {!isMobile && (hasTasksContent || hasFilesContent || hasStats) && (
            <>
              <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border/60" />
              {hasTasksContent && (
                <Tooltip content={activePanels.has("tasks") ? "Hide tasks" : "Show tasks"}>
                  <Button
                    variant="icon"
                    onClick={() => togglePanel("tasks")}
                    className={`shrink-0 ${activePanels.has("tasks") ? "!bg-accent/10 !text-accent" : ""}`}
                  >
                    <ListChecks size={15} strokeWidth={2} />
                  </Button>
                </Tooltip>
              )}
              {hasFilesContent && (
                <Tooltip content={activePanels.has("files") ? "Hide files" : "Show files"}>
                  <Button
                    variant="icon"
                    onClick={() => togglePanel("files")}
                    className={`shrink-0 ${activePanels.has("files") ? "!bg-accent/10 !text-accent" : ""}`}
                  >
                    <FileText size={15} strokeWidth={2} />
                  </Button>
                </Tooltip>
              )}
              {hasStats && instance.stats && (
                <ContextRing
                  stats={instance.stats}
                  active={activePanels.has("context")}
                  onClick={() => togglePanel("context")}
                />
              )}
            </>
          )}
          {/* Mobile: single sidecar button */}
          {isMobile && sidecarContentCount > 0 && (
            <>
              <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border/60" />
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
            </>
          )}
        </div>
      </div>

      {showDesktopSidecar ? (
        <Group orientation="horizontal" className="min-h-0 flex-1">
          <Panel defaultSize="75" minSize="40">
            <div className="flex h-full min-w-0 flex-col overflow-hidden">{chatContent}</div>
          </Panel>
          <ResizableHandle />
          <Panel defaultSize="25" minSize="15" maxSize="40">
            <Sidecar
              tasks={currentTasks}
              files={currentFiles}
              stats={instance.stats}
              items={items}
              rawHistory={rawHistory}
              provider={instance.provider}
              preferredModel={instance.preferredModel}
              instanceName={instance.name}
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
