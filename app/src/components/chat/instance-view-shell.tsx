import { CollapsedTerminalBar } from "@/components/terminal/terminal-collapsed-bar";
import { LazyTerminalPanel } from "@/components/terminal/lazy-terminal-panel";
import { Sidecar } from "@/components/chat/sidecar";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { InstanceViewContent } from "@/components/chat/instance-view-content";
import { InstanceViewHeader } from "@/components/chat/instance-view-header";
import { useInstanceViewContext } from "@/components/chat/instance-view-context";
import { useProviderRuntimeStore } from "@/stores/provider-runtime-store";

export function InstanceViewShell() {
  const { shared, actions } = useInstanceViewContext();
  const providerGlobalState = useProviderRuntimeStore((s) => s.providerGlobalState);
  const currentProviderGlobalState = providerGlobalState[shared.instance.provider];

  if (shared.compact) {
    return (
      <div className="flex h-full flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col">
          <InstanceViewContent />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <InstanceViewHeader />

      <div ref={shared.containerRef} className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <InstanceViewContent />
          </div>
          {shared.showTerminalPanel && !shared.isMobile && (
            <ErrorBoundary name="Terminal panel">
              <LazyTerminalPanel
                scope={shared.terminalScope}
                height={shared.terminalHeight}
                onResizeStart={actions.handleTerminalResizeStart}
                activeInstanceId={shared.id}
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
        {!shared.isMobile && (
          <div
            className={`relative flex h-full shrink-0 overflow-hidden ${
              shared.isResizing ? "" : "transition-[width,opacity] duration-200 ease-out"
            } ${shared.showDesktopSidecar ? "opacity-100" : "w-0 opacity-0"}`}
            ref={shared.sidecarRef}
            style={
              shared.showDesktopSidecar
                ? { width: shared.sidecarWidth ?? "max(280px, 30%)" }
                : undefined
            }
          >
            <div
              onMouseDown={actions.handleResizeStart}
              className="absolute inset-y-0 left-0 z-10 w-px cursor-col-resize bg-border/50 after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2 after:content-['']"
            />
            <div className="h-full flex-1 pl-px">
              <ErrorBoundary name="Sidecar">
                <Sidecar
                  tasks={shared.currentTasks}
                  files={shared.currentFiles}
                  planContent={shared.instance.planContent}
                  stats={shared.instance.stats}
                  items={shared.items}
                  provider={shared.instance.provider}
                  preferredModel={shared.instance.preferredModel}
                  providerStatus={shared.instance.providerStatus}
                  providerGlobalState={currentProviderGlobalState}
                  instanceId={shared.id}
                  createdAt={shared.instance.createdAt}
                  lastActivityAt={shared.instance.lastActivityAt}
                  workingDirectory={shared.instance.workingDirectory}
                  activePanels={shared.activePanels}
                />
              </ErrorBoundary>
            </div>
          </div>
        )}
      </div>
      {shared.isMobile && shared.sidecarMobileOpen && shared.sidecarContentCount > 0 && (
        <ErrorBoundary name="Sidecar">
          <Sidecar
            tasks={shared.currentTasks}
            files={shared.currentFiles}
            planContent={shared.instance.planContent}
            stats={shared.instance.stats}
            items={shared.items}
            provider={shared.instance.provider}
            preferredModel={shared.instance.preferredModel}
            providerStatus={shared.instance.providerStatus}
            providerGlobalState={currentProviderGlobalState}
            instanceId={shared.id}
            createdAt={shared.instance.createdAt}
            lastActivityAt={shared.instance.lastActivityAt}
            workingDirectory={shared.instance.workingDirectory}
            activePanels={shared.allContentPanels}
            onClose={() => actions.setSidecarMobileOpen(false)}
            isMobileOverlay
          />
        </ErrorBoundary>
      )}
    </div>
  );
}
