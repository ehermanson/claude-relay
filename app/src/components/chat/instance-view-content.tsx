import { useMemo } from "react";
import { motion } from "motion/react";
import { BranchChangeBanner } from "@/components/chat/branch-change-banner";
import { ConnectionStatusBanner } from "@/components/chat/connection-status-banner";
import { DebugModal } from "@/components/chat/debug-modal";
import { ExternalSessionBar } from "@/components/chat/external-session-bar";
import { InputArea } from "@/components/chat/input-area";
import { MessageList } from "@/components/chat/message-list";
import { MessageRelayProvider } from "@/components/chat/message-relay-context";
import { PermissionBanner } from "@/components/chat/permission-banner";
import { SpaceSuggestionCards } from "@/components/spaces/space-suggestion-cards";
import { TerminalPermissionBar } from "@/components/chat/terminal-permission-bar";
import { TerminalInputBanner } from "@/components/chat/terminal-input-banner";
import { TerminalContextStrip } from "@/components/terminal/terminal-context-strip";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { RelayLogo } from "@/components/ui/relay-logo";
import { useInstanceViewContext } from "@/components/chat/instance-view-context";
import { useWSMethods, useWSState } from "@/context/websocket-context";
import { useProviderRuntimeStore } from "@/stores/provider-runtime-store";

const MotionLogo = motion.create(RelayLogo);

export function InstanceViewContent() {
  const { shared, actions } = useInstanceViewContext();
  const { instances: allInstances } = useWSState();
  const providerGlobalState = useProviderRuntimeStore((s) => s.providerGlobalState);
  const { send } = useWSMethods();

  const spaceId = shared.instance.spaceId;
  const instanceId = shared.id;

  const relayValue = useMemo(() => {
    if (!spaceId) return null;

    const siblings = allInstances
      .filter((inst) => inst.spaceId === spaceId && inst.id !== instanceId)
      .map((inst) => ({ id: inst.id, name: inst.name, status: inst.status }));

    return {
      siblings,
      onSendToChat: (targetId: string, messageText: string) => {
        const sourceChat = allInstances.find((inst) => inst.id === instanceId);
        const sourceName = sourceChat?.name || "Unknown";
        const attributed = `[From: ${sourceName}] ${messageText}`;
        send({ type: "instance_message", instanceId: targetId, text: attributed });
      },
      onSendToNewChat: (messageText: string) => {
        // Store the message for delivery after instance creation
        // We'll use a custom event to coordinate this
        const sourceChat = allInstances.find((inst) => inst.id === instanceId);
        const sourceName = sourceChat?.name || "Unknown";
        const attributed = `[From: ${sourceName}] ${messageText}`;
        window.dispatchEvent(
          new CustomEvent("relay:send-to-new-chat", {
            detail: { spaceId, message: attributed },
          }),
        );
      },
    };
  }, [spaceId, instanceId, allInstances, send]);

  const loadingContent = (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-md flex-col items-center px-6 py-8 text-center">
        <MotionLogo
          size={112}
          connected={shared.isConnected}
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

  return (
    <>
      {shared.isLoadingSession ? (
        loadingContent
      ) : (
        <ErrorBoundary name="Message list">
          <MaybeRelayProvider value={relayValue}>
            <MessageList
              key={shared.id}
              items={shared.items}
              isProcessing={shared.isActive}
              showThinkingIndicator={shared.showThinkingIndicator}
              instanceStatus={shared.instance.status}
              lastActivity={shared.lastActivity}
              processingStartedAt={shared.processingStartedAt}
              onSendMessage={actions.handleSend}
              onAnswerUserInput={actions.handleAnswerUserInput}
              isInteractive={!shared.isStopped}
              onApproveTool={actions.handleApproveTool}
              approvedTools={shared.approvedTools}
              isExternal={!!shared.instance.sessionId}
              pendingInteraction={!!shared.instance.pendingPlan || !!shared.pendingUserInput}
              planChildId={shared.planChild?.id}
              planChildName={shared.planChild?.name}
              onInterruptAndSend={actions.handleInterruptAndSend}
            />
          </MaybeRelayProvider>
        </ErrorBoundary>
      )}

      {shared.showDebugPaste && (
        <DebugModal
          instance={shared.instance}
          items={shared.items}
          rawHistory={shared.rawHistory}
          isProcessing={shared.isActive}
          providerGlobalState={providerGlobalState[shared.instance.provider]}
          onClose={() => actions.setShowDebugPaste(false)}
        />
      )}

      <ConfirmActionDialog
        open={shared.confirmDelete}
        onOpenChange={actions.setConfirmDelete}
        title="Delete chat?"
        description={
          <>
            <span className="font-medium text-text">{shared.instance.name}</span> will be
            permanently removed.
          </>
        }
        confirmLabel="Delete"
        onConfirm={() => {
          actions.sendRemoveInstance();
          actions.setConfirmDelete(false);
          actions.navigateAfterDelete();
        }}
      />

      {shared.isPendingApproval &&
        shared.pendingApprovalRequest &&
        !shared.instance.external &&
        !shared.instance.pendingPlan && (
          <PermissionBanner
            key={shared.pendingApprovalRequest.requestId}
            provider={shared.instance.provider}
            request={shared.pendingApprovalRequest}
            onRespond={actions.handleRespondToRequest}
          />
        )}

      {shared.pendingTerminalInput && !shared.pendingUserInput && !shared.instance.external && (
        <TerminalInputBanner
          provider={shared.instance.provider}
          request={shared.pendingTerminalInput}
          onRespond={actions.handleRespondToRequest}
        />
      )}

      {shared.pendingTerminalTool && !shared.pendingUserInput && !shared.pendingTerminalInput && (
        <TerminalPermissionBar
          provider={shared.instance.provider}
          pendingTool={shared.pendingTerminalTool}
        />
      )}

      {shared.connectionBanner && (
        <ConnectionStatusBanner
          kind={shared.connectionBanner.kind}
          onContinue={shared.connectionBanner.onContinue}
          onDismiss={shared.connectionBanner.onDismiss}
        />
      )}

      {!shared.isLoadingSession &&
        shared.showBranchChangeBanner &&
        shared.instance.branchChanged && (
          <BranchChangeBanner
            originalBranch={shared.instance.branchChanged.originalBranch}
            currentBranch={shared.instance.branchChanged.currentBranch}
            onDismiss={actions.dismissBranchChangeBanner}
          />
        )}

      {!shared.isLoadingSession &&
        (shared.instance.external ? (
          <ExternalSessionBar
            isStopped={shared.isStopped}
            isConnected={shared.isConnected}
            onTakeover={actions.handleTakeover}
            provider={shared.instance.provider}
            model={shared.instance.stats?.model}
          />
        ) : (
          <ErrorBoundary name="Input area" inline>
            {spaceId &&
              shared.items.length === 0 &&
              !shared.isActive &&
              // Hide suggestions for brand-new spaces — they reference prior
              // work that doesn't exist yet. Show only when the space already
              // has other chats (i.e. this isn't the very first one).
              allInstances.filter((inst) => inst.spaceId === spaceId).length > 1 && (
                <div className="mx-auto w-full max-w-3xl px-6">
                  <SpaceSuggestionCards onSelect={(prompt) => actions.handleSend(prompt)} />
                </div>
              )}
            <InputArea
              onSend={actions.handleSend}
              onAnswerUserInput={actions.handleAnswerUserInput}
              onCancel={actions.handleCancel}
              onSwitchProvider={actions.handleSwitchProvider}
              isProcessing={shared.isActive}
              isConnected={shared.isConnected}
              instanceId={shared.id}
              isStopped={shared.isStopped}
              provider={shared.instance.provider}
              preferredModel={shared.instance.preferredModel}
              reasoningBudget={shared.instance.reasoningBudget}
              modelOptions={shared.instance.modelOptions}
              planMode={shared.instance.planMode}
              activeModel={shared.instance.stats?.model}
              skipPermissions={shared.instance.skipPermissions}
              hasMessages={shared.items.length > 0}
              pendingUserInput={shared.pendingUserInput}
              pendingPlan={shared.instance.pendingPlan}
              topSlot={
                <TerminalContextStrip
                  attachments={shared.terminalContexts}
                  onRemove={actions.removeTerminalContext}
                />
              }
            />
          </ErrorBoundary>
        ))}
    </>
  );
}

/** Wraps children in MessageRelayProvider only when relay is available (i.e., inside a space). */
function MaybeRelayProvider({
  value,
  children,
}: {
  value: Parameters<typeof MessageRelayProvider>[0]["value"] | null;
  children: React.ReactNode;
}) {
  if (!value) return <>{children}</>;
  return <MessageRelayProvider value={value}>{children}</MessageRelayProvider>;
}
