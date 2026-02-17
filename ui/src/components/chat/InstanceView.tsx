import { useEffect, useCallback, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useWS } from "../../context/WebSocketContext";
import { useInstanceMessages } from "../../hooks/useInstanceMessages";
import { MessageList } from "./MessageList";
import { InputArea } from "./InputArea";
import { shortenPath } from "../../lib/utils";
import type { ServerMessage } from "@shared/types";

export function InstanceView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isConnected, instances, send, subscribe, unsubscribe, addMessageHandler } =
    useWS();

  const { items, isProcessing, handleMessage, setInstanceId, showThinking } =
    useInstanceMessages();

  const instance = instances.find((i) => i.id === id);

  // Subscribe/unsubscribe on mount/change
  useEffect(() => {
    if (!id) return;
    setInstanceId(id);
    subscribe(id);
    return () => {
      unsubscribe(id);
      setInstanceId(null);
    };
  }, [id, subscribe, unsubscribe, setInstanceId]);

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
      navigate("/chat", { replace: true });
    }
  }, [isConnected, instances, id, instance, navigate]);

  const handleSend = useCallback(
    (text: string) => {
      if (!id) return;
      send({ type: "instance_message", instanceId: id, text });
      showThinking();
    },
    [id, send, showThinking]
  );

  const handleCancel = useCallback(() => {
    if (!id || !isProcessing) return;
    send({ type: "instance_cancel", instanceId: id });
  }, [id, isProcessing, send]);

  const handleResume = useCallback(() => {
    if (!id) return;
    send({ type: "resume_instance", instanceId: id });
  }, [id, send]);

  const [approvedTools, setApprovedTools] = useState<Set<string>>(new Set());

  const handleApproveTool = useCallback(
    (tool: string) => {
      if (!id) return;
      setApprovedTools((prev) => {
        if (prev.has(tool)) return prev;
        send({ type: "approve_tool", instanceId: id, tool });
        showThinking();
        const next = new Set(prev);
        next.add(tool);
        return next;
      });
    },
    [id, send, showThinking]
  );

  if (!instance) {
    return null;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={() => navigate("/chat")}
            title="Back"
            className="hidden items-center justify-center rounded border border-border bg-transparent text-muted transition-all hover:border-accent hover:text-accent md:hidden max-[768px]:flex h-7 w-7"
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
          </button>
          <span className="truncate text-sm font-semibold tracking-tight text-text-bright">
            {instance.name}
          </span>
          <div className="flex shrink-0 items-center gap-1.5 text-[0.6875rem] text-muted">
            <span
              className={`h-[7px] w-[7px] rounded-full ${
                instance.status === "processing"
                  ? "animate-pulse-dot bg-warning shadow-[0_0_8px_var(--color-warning-glow)]"
                  : "bg-success shadow-[0_0_8px_var(--color-accent-glow)]"
              }`}
            />
            <span>
              {instance.status === "processing"
                ? instance.external
                  ? "Active"
                  : "Processing"
                : instance.external
                  ? "Monitoring"
                  : "Connected"}
            </span>
          </div>
        </div>
        <span className="min-w-0 shrink truncate text-right text-[0.6875rem] text-muted">
          {shortenPath(instance.workingDirectory)}
        </span>
      </div>

      <MessageList items={items} onSendMessage={handleSend} isInteractive={!instance.external} onApproveTool={!instance.external ? handleApproveTool : undefined} approvedTools={approvedTools} />

      <InputArea
        onSend={handleSend}
        onCancel={handleCancel}
        isProcessing={isProcessing}
        isConnected={isConnected}
        isExternal={instance.external}
        onResume={instance.external ? handleResume : undefined}
      />
    </div>
  );
}
