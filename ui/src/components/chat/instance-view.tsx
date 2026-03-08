import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, Link } from "@tanstack/react-router";
import { Group, Panel } from "react-resizable-panels";
import { useWSMethods, useWSState } from "../../context/websocket-context";
import { useInstanceMessages } from "../../hooks/use-instance-messages";
import { useMediaQuery } from "../../hooks/use-media-query";
import { MessageList } from "./message-list";
import { InputArea } from "./input-area";
import { Sidecar } from "./sidecar";
import { ResizableHandle } from "../ui/resizable-handle";
import { Dialog } from "../ui/dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import { PermissionBanner } from "./permission-banner";
import { MergeBanner } from "./merge-banner";
import { shortenPath, formatTokens, formatCost } from "../../lib/utils";
import type { ServerMessage } from "@shared/types";

import type { InstanceInfo } from "@shared/types";
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
  const { chatId: id } = useParams({ strict: false }) as { chatId?: string };
  const navigate = useNavigate();
  const { send, subscribe, unsubscribe, addMessageHandler } = useWSMethods();
  const { isConnected, connectionId, instances } = useWSState();

  const {
    items,
    isProcessing,
    showThinkingIndicator,
    currentTasks,
    currentFiles,
    currentTeam,
    currentAgentActivities,
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

  const handleSend = (text: string, images?: string[]) => {
    if (!id) return;
    send({ type: "instance_message", instanceId: id, text, images });
    showThinking();
  };

  const handleCancel = () => {
    if (!id || !isProcessing) return;
    send({ type: "instance_cancel", instanceId: id });
  };

  const isMobile = useMediaQuery("(max-width: 768px)");
  const [approvedTools, setApprovedTools] = useState<Set<string>>(new Set());
  const [showDebugPaste, setShowDebugPaste] = useState(false);
  const [sidecarDismissed, setSidecarDismissed] = useState(false);
  const [sidecarMobileOpen, setSidecarMobileOpen] = useState(false);
  const dismissedContentCountRef = useRef(0);

  // Reset dismiss when switching instances
  useEffect(() => {
    setSidecarDismissed(false);
    dismissedContentCountRef.current = 0;
  }, [id]);

  // Un-dismiss if new content is added after dismissal
  const sidecarContentCount =
    (currentTasks?.length ?? 0) + (currentFiles?.length ?? 0) + (currentTeam?.members?.length ?? 0);
  useEffect(() => {
    if (sidecarDismissed && sidecarContentCount > dismissedContentCountRef.current) {
      setSidecarDismissed(false);
    }
  }, [sidecarDismissed, sidecarContentCount]);

  const handleDismissSidecar = () => {
    dismissedContentCountRef.current =
      (currentTasks?.length ?? 0) +
      (currentFiles?.length ?? 0) +
      (currentTeam?.members?.length ?? 0);
    setSidecarDismissed(true);
  };

  const handleMerge = () => {
    if (!id) return;
    send({ type: "merge_instance", instanceId: id });
  };

  const handleApproveTool = (tool: string) => {
    if (!id) return;
    setApprovedTools((prev) => {
      if (prev.has(tool)) return prev;
      send({ type: "approve_tool", instanceId: id, tool });
      showThinking();
      const next = new Set(prev);
      next.add(tool);
      return next;
    });
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
  const pendingPermissionDesc =
    rawPermission && typeof rawPermission === "object" ? rawPermission.description : undefined;

  const chatContent = (
    <>
      <MessageList
        items={items}
        isProcessing={isProcessing}
        showThinkingIndicator={showThinkingIndicator}
        instanceStatus={instance.status}
        onSendMessage={handleSend}
        isInteractive={!isStopped}
        onApproveTool={handleApproveTool}
        approvedTools={approvedTools}
        isExternal={!!instance.sessionId}
        planChildId={planChild?.id}
        planChildName={planChild?.name}
      />
      {showDebugPaste && (
        <DebugModal
          instance={instance}
          items={items}
          isProcessing={isProcessing}
          onClose={() => setShowDebugPaste(false)}
        />
      )}

      {pendingPermissionTool && !instance.external && (
        <PermissionBanner
          key={pendingPermissionTool}
          tool={pendingPermissionTool}
          description={pendingPermissionDesc}
          onApprove={handleApproveTool}
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
                Claude is waiting for approval to use {pendingTerminalTool}. Switch to your terminal
                to respond.
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

      <InputArea
        onSend={handleSend}
        onCancel={handleCancel}
        isProcessing={isProcessing}
        isConnected={isConnected}
        instanceId={id!}
        sessionId={instance.sessionId}
        isStopped={isStopped}
        isExternal={!!instance.external}
        isPendingInTerminal={!!pendingTerminalTool}
        preferredModel={instance.preferredModel}
        activeModel={instance.stats?.model}
        skipPermissions={instance.skipPermissions}
      />
    </>
  );

  // Status dot + label
  let dotClass: string;
  let statusLabel: string;
  if (isStopped) {
    dotClass = "bg-muted";
    statusLabel = "Ended";
  } else if (instance.status === "processing") {
    dotClass = "animate-pulse-dot bg-warning";
    statusLabel = instance.external ? "Active" : "Processing";
  } else if (instance.external) {
    dotClass = "bg-accent";
    statusLabel = "Watching";
  } else {
    dotClass = "bg-accent";
    statusLabel = "Connected";
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-3">
        <Tooltip content="Back">
          <Link
            to="/projects/$projectId/chats"
            params={{
              projectId: instance.workingDirectory.split("/").pop() || "",
            }}
            className="hidden h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text max-[768px]:flex"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
        </Tooltip>
        <div className="min-w-0 flex-1">
          <Tooltip content={instance.workingDirectory} side="bottom">
            <Link
              to="/projects/$projectId/chats"
              params={{
                projectId: instance.workingDirectory.split("/").pop() || instance.workingDirectory,
              }}
              className="hidden truncate text-[0.6875rem] text-muted transition-colors hover:text-accent sm:block"
            >
              {instance.workingDirectory.split("/").pop() || instance.workingDirectory}
            </Link>
          </Tooltip>
          <h1 className="truncate text-[0.9375rem] font-semibold tracking-tight text-text-bright">
            {instance.name}
          </h1>
        </div>
        <Badge dot dotClass={dotClass}>
          {statusLabel}
        </Badge>
        {instance.gitBranch && (
          <Tooltip
            content={`Working in worktree on branch ${instance.gitBranch}${instance.originalDirectory ? ` (from ${instance.originalDirectory})` : ""}`}
          >
            <Badge variant="accent" className="hidden sm:flex">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              {instance.gitBranch}
            </Badge>
          </Tooltip>
        )}
        {instance.stats && instance.stats.costUSD > 0 && (
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
            <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted sm:flex">
              {formatTokens(instance.stats.inputTokens + instance.stats.outputTokens)} tokens · ~
              {formatCost(instance.stats.costUSD)}
            </span>
          </Tooltip>
        )}
        {isMobile && sidecarContentCount > 0 && (
          <Tooltip content="Tasks & files">
            <Button
              variant="icon"
              onClick={() => setSidecarMobileOpen(true)}
              className="relative shrink-0"
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-claude px-0.5 text-[0.5625rem] font-semibold leading-none text-white">
                {sidecarContentCount}
              </span>
            </Button>
          </Tooltip>
        )}
        <Tooltip content="Debug session data">
          <Button variant="icon" onClick={() => setShowDebugPaste(true)} className="shrink-0">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 2l1.88 1.88" />
              <path d="M14.12 3.88L16 2" />
              <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
              <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
              <path d="M12 20v-9" />
              <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
              <path d="M6 13H2" />
              <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
              <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
              <path d="M22 13h-4" />
              <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
            </svg>
          </Button>
        </Tooltip>
      </div>

      {!isMobile && sidecarContentCount > 0 && !sidecarDismissed ? (
        <Group orientation="horizontal" className="min-h-0 flex-1">
          <Panel defaultSize="75" minSize="40">
            <div className="flex h-full min-w-0 flex-col">{chatContent}</div>
          </Panel>
          <ResizableHandle />
          <Panel defaultSize="25" minSize="15" maxSize="40" collapsible collapsedSize="0">
            <Sidecar
              tasks={currentTasks}
              files={currentFiles}
              team={currentTeam}
              agentActivities={currentAgentActivities}
              workingDirectory={instance.workingDirectory}
              onClose={handleDismissSidecar}
            />
          </Panel>
        </Group>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">{chatContent}</div>
        </div>
      )}
      {isMobile && sidecarMobileOpen && sidecarContentCount > 0 && (
        <Sidecar
          tasks={currentTasks}
          files={currentFiles}
          team={currentTeam}
          agentActivities={currentAgentActivities}
          workingDirectory={instance.workingDirectory}
          onClose={() => setSidecarMobileOpen(false)}
          isMobileOverlay
        />
      )}
    </div>
  );
}
