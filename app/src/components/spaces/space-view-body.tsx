import type { ComponentProps } from "react";
import { Check, Copy, FolderOpen, GitBranch, Plus } from "lucide-react";
import { Group, Panel } from "react-resizable-panels";
import { InstanceView } from "@/components/chat/instance-view";
import { SpaceChatTabs } from "@/components/spaces/space-chat-tabs";
import { SpaceSidebar } from "@/components/spaces/space-sidebar";
import { useSpaceViewContext } from "@/components/spaces/space-view-context";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ResizableHandle } from "@/components/ui/resizable-handle";
import { CollapsedTerminalBar, TerminalPanel } from "@/components/terminal/terminal-panel";
import type { InstanceInfo } from "@shared/types";

export function SpaceViewBody() {
  const { shared, actions } = useSpaceViewContext();
  const chatTabsProps: ComponentProps<typeof SpaceChatTabs> = {
    instances: shared.spaceInstances,
    activeTab: shared.activeTab,
    onNavigateToChat: actions.navigateToChat,
    onRenameTab: actions.handleRenameTab,
    onCloseTab: (id) => actions.setCloseTabId(id),
    onNewChat: actions.handleNewChat,
  };

  const openDiffAndCloseMobile = (scrollTo?: string) => {
    actions.openDiff(scrollTo);
    actions.setSidecarMobileOpen(false);
  };

  return (
    <>
      {shared.isMerged && (
        <div className="flex items-center gap-2 border-b border-border bg-surface-dim px-4 py-2 text-xs text-text-muted">
          <span>
            This space has been merged into{" "}
            <span className="font-medium text-text">
              {shared.space.targetBranch || "the main branch"}
            </span>
            .
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={actions.handleGoToMainWorkspace}
            className="ml-auto text-xs"
          >
            Go to main workspace
          </Button>
        </div>
      )}
      {shared.isArchived && (
        <div className="flex items-center gap-2 border-b border-border bg-surface-dim px-4 py-2 text-xs text-text-muted">
          This space has been archived. Chats and history are still available.
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {shared.activeTab ? (
            shared.showSidebar && !shared.isMobile ? (
              <Group orientation="horizontal" className="flex-1">
                <Panel defaultSize="70" minSize="40">
                  <SpaceChatArea
                    activeTab={shared.activeTab}
                    activeLiveInstance={shared.activeLiveInstance}
                    chatTabsProps={chatTabsProps}
                  />
                </Panel>
                <ResizableHandle />
                <Panel defaultSize="30" minSize="15" maxSize="45">
                  <SpaceSidebar
                    space={shared.space}
                    instances={shared.spaceInstances}
                    activePanels={shared.activePanels}
                    stats={shared.aggregatedStats}
                    fileChanges={shared.fileChanges}
                    onOpenDiff={actions.openDiff}
                  />
                </Panel>
              </Group>
            ) : (
              <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
                <SpaceChatArea
                  activeTab={shared.activeTab}
                  activeLiveInstance={shared.activeLiveInstance}
                  chatTabsProps={chatTabsProps}
                />
              </div>
            )
          ) : shared.isResolvingChatSelection ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <Spinner size={18} />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-text-bright">Opening space</p>
                <p className="max-w-xs text-[0.8125rem] text-muted">
                  Resolving the most recent chat in this space.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <GitBranch size={32} className="text-muted/30" />
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-text-bright">Space ready</p>
                <p className="max-w-xs text-[0.8125rem] text-muted">
                  This space has its own branch and working copy. Start a chat to begin working.
                </p>
              </div>
              {shared.space.worktreePath && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-hover/50 px-3 py-2 text-xs">
                  <FolderOpen size={13} className="shrink-0 text-muted/70" />
                  <code
                    className="max-w-[20rem] truncate font-mono text-[0.6875rem] text-muted"
                    title={shared.space.worktreePath}
                  >
                    {shared.space.worktreePath}
                  </code>
                  <button
                    type="button"
                    onClick={actions.handleCopyPath}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] text-muted transition-colors hover:bg-surface-hover hover:text-text"
                  >
                    {shared.pathCopied ? <Check size={11} /> : <Copy size={11} />}
                    {shared.pathCopied ? "Copied" : "Copy"}
                  </button>
                </div>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={actions.handleNewChat}
                className="gap-1.5"
              >
                <Plus size={14} />
                New Chat
              </Button>
            </div>
          )}
        </div>
        {shared.showTerminalPanel && !shared.isMobile && (
          <ErrorBoundary name="Terminal panel">
            <TerminalPanel
              scope={shared.terminalScope}
              height={shared.terminalHeight}
              onResizeStart={actions.handleTerminalResizeStart}
              activeInstanceId={shared.activeTab}
            />
          </ErrorBoundary>
        )}
        {shared.isTerminalCollapsed && !shared.isMobile && shared.collapsedTerminalCount > 0 && (
          <CollapsedTerminalBar
            terminalCount={shared.collapsedTerminalCount}
            onExpand={actions.expandTerminalPanel}
          />
        )}
      </div>

      {shared.isMobile && shared.sidecarMobileOpen && shared.sidecarContentCount > 0 && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          onClick={() => actions.setSidecarMobileOpen(false)}
        >
          <div className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative h-full" onClick={(e) => e.stopPropagation()}>
            <SpaceSidebar
              space={shared.space}
              instances={shared.spaceInstances}
              activePanels={shared.allContentPanels}
              stats={shared.aggregatedStats}
              fileChanges={shared.fileChanges}
              onOpenDiff={openDiffAndCloseMobile}
              isMobileOverlay
              onClose={() => actions.setSidecarMobileOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}

function SpaceChatArea({
  activeTab,
  activeLiveInstance,
  chatTabsProps,
}: {
  activeTab: string;
  activeLiveInstance: InstanceInfo | null;
  chatTabsProps: ComponentProps<typeof SpaceChatTabs>;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SpaceChatTabs {...chatTabsProps} />
      {activeLiveInstance ? (
        <InstanceView key={activeTab} instanceId={activeTab} compact />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
          <div className="flex w-full max-w-md flex-col items-center px-6 py-8 text-center">
            <Spinner size={18} />
            <p className="mt-4 text-[0.875rem] font-medium text-text-bright">Restoring chat</p>
            <p className="mt-1 text-[0.75rem] text-muted">
              Waiting for the live chat state to reconnect.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
