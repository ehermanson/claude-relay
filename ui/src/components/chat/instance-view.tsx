import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "@tanstack/react-router";
import { useWSMethods, useWSState } from "../../context/websocket-context";
import { useInstanceMessages } from "../../hooks/use-instance-messages";
import { useMediaQuery } from "../../hooks/use-media-query";
import { MessageList } from "./message-list";
import { InputArea } from "./input-area";
import { Sidecar } from "./sidecar";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip } from "../ui/tooltip";
import { OpenInMenu } from "../project/open-in-menu";
import { PermissionBanner } from "./permission-banner";
import { MergeBanner } from "./merge-banner";
import { Bug, ChevronLeft, GitBranch, LayoutGrid } from "lucide-react";
import { shortenPath, formatTokens, formatCost } from "../../lib/utils";
import { createInstance, fetchInstanceHistory } from "../../lib/api";
import { buildProviderSwitchHandoffPrompt } from "@shared/session-handoff";
import type { ServerMessage } from "@shared/types";

import type { AgentActivity, InstanceInfo, ProviderKind } from "@shared/types";
import type { ChatItem } from "../../hooks/use-instance-messages";

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
    currentTeam,
    currentAgentActivities,
    lastActivity,
    processingStartedAt,
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
  const [sidecarDismissed, setSidecarDismissed] = useState(false);
  const [sidecarMobileOpen, setSidecarMobileOpen] = useState(false);
  const [retainedAgentActivities, setRetainedAgentActivities] = useState<AgentActivity[] | null>(
    null,
  );
  const dismissedContentCountRef = useRef(0);

  // Reset dismiss when switching instances
  useEffect(() => {
    setSidecarDismissed(false);
    setSidecarMobileOpen(false);
    setRetainedAgentActivities(null);
    dismissedContentCountRef.current = 0;
  }, [id]);

  const hasLiveAgentActivities = (currentAgentActivities?.length ?? 0) > 0;
  const retainedClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Agent activity arrives as a high-frequency, non-persistent stream.
  // Once we have agent activity for a loaded chat, keep showing it for the
  // rest of that chat session instead of treating it like a temporary pulse.
  // When live activities go empty during processing, hold retained for 2s
  // to avoid sub-second flicker between tabbed and non-tabbed sidecar.
  useEffect(() => {
    if (hasLiveAgentActivities) {
      // New live data — update retained and cancel any pending clear
      if (retainedClearTimerRef.current) {
        clearTimeout(retainedClearTimerRef.current);
        retainedClearTimerRef.current = null;
      }
      setRetainedAgentActivities(currentAgentActivities);
    } else if (!isProcessing && retainedAgentActivities) {
      // Processing ended — clear retained after a short hold
      if (!retainedClearTimerRef.current) {
        retainedClearTimerRef.current = setTimeout(() => {
          setRetainedAgentActivities(null);
          retainedClearTimerRef.current = null;
        }, 2000);
      }
    }
    // During processing with no live activities — keep retained as-is (no timer)
  }, [currentAgentActivities, hasLiveAgentActivities, isProcessing, retainedAgentActivities]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (retainedClearTimerRef.current) {
        clearTimeout(retainedClearTimerRef.current);
      }
    };
  }, []);

  const sidecarAgentActivities =
    hasLiveAgentActivities && currentAgentActivities
      ? currentAgentActivities
      : retainedAgentActivities;
  const deferredSidecarAgentActivities = useDeferredValue(sidecarAgentActivities);

  // Un-dismiss if new content is added after dismissal
  const sidecarContentCount =
    (currentTasks?.length ?? 0) +
    (currentFiles?.length ?? 0) +
    (currentTeam?.members?.length ?? 0) +
    (sidecarAgentActivities?.length ?? 0);
  useEffect(() => {
    if (sidecarDismissed && sidecarContentCount > dismissedContentCountRef.current) {
      setSidecarDismissed(false);
    }
  }, [sidecarDismissed, sidecarContentCount]);

  const handleDismissSidecar = () => {
    dismissedContentCountRef.current =
      (currentTasks?.length ?? 0) +
      (currentFiles?.length ?? 0) +
      (currentTeam?.members?.length ?? 0) +
      (sidecarAgentActivities?.length ?? 0);
    setSidecarDismissed(true);
  };

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
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Spinner size={20} className="text-accent" />
        </div>
        <p className="text-[0.875rem] font-medium text-text-bright">Loading session</p>
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
          <Dialog.Title>Take over terminal session?</Dialog.Title>
          <p className="text-sm text-muted">
            This will stop the Claude process running in your terminal and continue the session here
            in Relay. You won't be able to resume it in the terminal afterward.
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
          activeModel={instance.stats?.model}
          skipPermissions={instance.skipPermissions}
          stats={instance.stats}
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
    statusLabel = instance.external ? "External session (ended)" : "Ended";
  } else if (instance.status === "processing") {
    dotClass = "animate-pulse-dot bg-warning";
    statusLabel = instance.external ? "External session (active)" : "Processing";
  } else if (instance.external) {
    dotClass = "bg-accent";
    statusLabel = "External session";
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
        {/* Action buttons */}
        <div className="flex items-center gap-1">
          <OpenInMenu path={instance.workingDirectory} className="hidden sm:flex" />
          {sidecarContentCount > 0 && (
            <Tooltip
              content={isMobile ? "Sidecar" : sidecarDismissed ? "Show sidecar" : "Hide sidecar"}
            >
              <Button
                variant="icon"
                onClick={() => {
                  if (isMobile) {
                    setSidecarMobileOpen(true);
                  } else if (sidecarDismissed) {
                    setSidecarDismissed(false);
                  } else {
                    handleDismissSidecar();
                  }
                }}
                className="relative shrink-0"
              >
                <LayoutGrid size={15} strokeWidth={2} />
                {(isMobile || sidecarDismissed) && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-claude px-0.5 text-[0.5625rem] font-semibold leading-none text-white">
                    {sidecarContentCount}
                  </span>
                )}
              </Button>
            </Tooltip>
          )}
          <Tooltip content="Debug session data">
            <Button variant="icon" onClick={() => setShowDebugPaste(true)} className="shrink-0">
              <Bug size={15} strokeWidth={2} />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">{chatContent}</div>
        {!isMobile && sidecarContentCount > 0 && (
          <div
            className={`shrink-0 overflow-hidden transition-[width] duration-300 ease-in-out ${
              sidecarDismissed ? "w-0" : "w-80"
            }`}
          >
            <div className="h-full w-80">
              <Sidecar
                tasks={currentTasks}
                files={currentFiles}
                team={currentTeam}
                agentActivities={deferredSidecarAgentActivities}
                workingDirectory={instance.workingDirectory}
                onClose={handleDismissSidecar}
              />
            </div>
          </div>
        )}
      </div>
      {isMobile && sidecarMobileOpen && sidecarContentCount > 0 && (
        <Sidecar
          tasks={currentTasks}
          files={currentFiles}
          team={currentTeam}
          agentActivities={deferredSidecarAgentActivities}
          workingDirectory={instance.workingDirectory}
          onClose={() => setSidecarMobileOpen(false)}
          isMobileOverlay
        />
      )}
    </div>
  );
}
