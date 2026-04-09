import { useEffect, useRef, useState } from "react";
import { ContextPanel } from "@/components/chat/context-panel";
import { FilesPanel } from "@/components/chat/files-panel";
import { SidecarShell, type SidecarTabDef } from "@/components/chat/sidecar-shell";
import { SpaceContextPanel } from "@/components/spaces/space-context-panel";
import type { SidecarTab } from "@/stores/sidecar-store";
import type { FileChange, InstanceInfo, SessionStats, SpaceInfo } from "@shared/types";

export function SpaceSidebar({
  space,
  instances,
  activePanels,
  stats,
  fileChanges,
  onOpenDiff,
  isMobileOverlay,
  onClose,
}: {
  space: SpaceInfo;
  instances: InstanceInfo[];
  activePanels: ReadonlySet<SidecarTab>;
  stats: SessionStats | null;
  fileChanges: FileChange[];
  onOpenDiff: (scrollToFile?: string) => void;
  isMobileOverlay?: boolean;
  onClose?: () => void;
}) {
  const activeCount = instances.filter(
    (instance) => instance.status === "idle" || instance.status === "processing",
  ).length;
  const stoppedCount = instances.filter((instance) => instance.status === "stopped").length;

  const hasFiles = activePanels.has("files");
  const hasStats =
    activePanels.has("context") && !!stats && (stats.inputTokens > 0 || stats.outputTokens > 0);

  const availableTabs: SidecarTabDef[] = [];
  if (activePanels.has("brief") && !space.isDefault)
    availableTabs.push({ key: "space-context", label: "Brief" });
  if (hasFiles) availableTabs.push({ key: "files", label: "Files", count: fileChanges.length });
  if (hasStats) availableTabs.push({ key: "context", label: "Context" });

  const [activeTab, setActiveTab] = useState(availableTabs[0]?.key ?? "space-context");

  const prevPanelsRef = useRef(activePanels);
  useEffect(() => {
    const prev = prevPanelsRef.current;
    prevPanelsRef.current = activePanels;
    for (const panel of activePanels) {
      if (!prev.has(panel)) {
        setActiveTab(panel);
        return;
      }
    }
  }, [activePanels]);

  const renderTabContent = (key: string) => {
    if (key === "space-context" && !space.isDefault) {
      return (
        <div className="flex-1 overflow-y-auto">
          <SpaceContextPanel spaceId={space.id} />
        </div>
      );
    }
    if (key === "files" && hasFiles) {
      if (fileChanges.length === 0) {
        return (
          <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 text-center text-muted">
            <p className="text-sm">No files changed</p>
          </div>
        );
      }
      return (
        <FilesPanel
          files={fileChanges}
          cwd=""
          onViewChanges={() => onOpenDiff()}
          onFileClick={(path) => onOpenDiff(path)}
        />
      );
    }
    if (key === "context" && hasStats) {
      return (
        <ContextPanel
          mode="space"
          stats={stats}
          instances={instances}
          branch={space.gitBranch ?? null}
          status={space.status}
          activeCount={activeCount}
          stoppedCount={stoppedCount}
          createdAt={space.createdAt}
        />
      );
    }
    return null;
  };

  return (
    <SidecarShell
      tabs={availableTabs}
      activeTab={activeTab}
      onActiveTabChange={setActiveTab}
      renderTabContent={renderTabContent}
      isMobileOverlay={isMobileOverlay}
      onClose={onClose}
    />
  );
}
