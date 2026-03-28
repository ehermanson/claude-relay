import { motion } from "motion/react";
import { BranchChangeBanner } from "@/components/chat/branch-change-banner";
import { ConnectionStatusBanner } from "@/components/chat/connection-status-banner";
import { DebugModal } from "@/components/chat/debug-modal";
import { ExternalSessionBar } from "@/components/chat/external-session-bar";
import { InputArea } from "@/components/chat/input-area";
import { MessageList } from "@/components/chat/message-list";
import { PermissionBanner } from "@/components/chat/permission-banner";
import { TerminalPermissionBar } from "@/components/chat/terminal-permission-bar";
import { TerminalContextStrip } from "@/components/terminal/terminal-context-strip";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { RelayLogo } from "@/components/ui/relay-logo";
import { useInstanceViewContext } from "@/components/chat/instance-view-context";

const MotionLogo = motion.create(RelayLogo);

export function InstanceViewContent() {
  const { shared, actions } = useInstanceViewContext();

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
          />
        </ErrorBoundary>
      )}

      {shared.showDebugPaste && (
        <DebugModal
          instance={shared.instance}
          items={shared.items}
          isProcessing={shared.isActive}
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
        shared.pendingPermissionTool &&
        shared.pendingPermissionRequestId &&
        !shared.instance.external &&
        !shared.instance.pendingPlan && (
          <PermissionBanner
            key={shared.pendingPermissionRequestId}
            provider={shared.instance.provider}
            requestId={shared.pendingPermissionRequestId}
            tool={shared.pendingPermissionTool}
            description={shared.pendingPermissionDesc}
            onApprove={actions.handleRespondToRequest}
          />
        )}

      {shared.pendingTerminalTool && !shared.pendingUserInput && (
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
