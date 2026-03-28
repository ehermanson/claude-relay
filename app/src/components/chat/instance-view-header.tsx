import { InstanceHeader } from "@/components/chat/instance-header";
import { useInstanceViewContext } from "@/components/chat/instance-view-context";

export function InstanceViewHeader() {
  const { shared, actions } = useInstanceViewContext();

  if (shared.compact) {
    return null;
  }

  return (
    <InstanceHeader
      instance={shared.instance}
      isMobile={shared.isMobile}
      activePanels={new Set(shared.activePanels)}
      hasTasksContent={shared.hasTasksContent}
      hasFilesContent={shared.hasFilesContent}
      hasPlanContent={shared.hasPlanContent}
      hasStats={shared.hasStats}
      sidecarContentCount={shared.sidecarContentCount}
      loadingSidecarActions={shared.isLoadingSession}
      onTogglePanel={actions.togglePanel}
      onOpenDebug={() => actions.setShowDebugPaste(true)}
      onDelete={() => actions.setConfirmDelete(true)}
      onOpenMobileSidecar={() => actions.setSidecarMobileOpen(true)}
      onSplit={actions.navigateToSplitPicker}
      onToggleTerminal={actions.handleToggleTerminal}
      terminalOpen={shared.showTerminalPanel || shared.isTerminalCollapsed}
    />
  );
}
