import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { ContextPanel } from "@/components/chat/context-panel";
import { FilesPanel } from "@/components/chat/files-panel";
import { SpaceContextPanel } from "@/components/spaces/space-context-panel";
import { Button } from "@/components/ui/button";
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

  type Tab = { key: string; label: string; count: number };
  const availableTabs: Tab[] = [];
  if (activePanels.has("brief") && !space.isDefault)
    availableTabs.push({ key: "space-context", label: "Brief", count: 0 });
  if (hasFiles) availableTabs.push({ key: "files", label: "Files", count: fileChanges.length });
  if (hasStats) availableTabs.push({ key: "context", label: "Context", count: 0 });

  const [activeTab, setActiveTab] = useState(availableTabs[0]?.key ?? "space-context");
  const effectiveTab =
    availableTabs.find((tab) => tab.key === activeTab)?.key ?? availableTabs[0]?.key;

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

  return (
    <div
      className={
        isMobileOverlay
          ? "@container/sidecar animate-slide-in-right flex h-full w-[85vw] max-w-sm flex-col overflow-hidden rounded-l-2xl border-l border-border bg-surface shadow-2xl"
          : "@container/sidecar flex h-full flex-col border-l border-border bg-surface"
      }
    >
      <div className="flex shrink-0 items-center border-b border-border/60">
        {isMobileOverlay && onClose && (
          <Button variant="icon" size="icon-sm" onClick={onClose} className="ml-2 shrink-0">
            <X size={14} />
          </Button>
        )}
        <div className="flex min-w-0 flex-1 items-stretch">
          {availableTabs.map((tab) => {
            const isActive = tab.key === effectiveTab;
            const isSingle = availableTabs.length === 1;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => !isSingle && setActiveTab(tab.key)}
                className={`relative flex min-w-0 items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                  isSingle
                    ? "cursor-default border-transparent text-text-bright"
                    : isActive
                      ? "flex-1 justify-center border-accent text-text-bright"
                      : "flex-1 justify-center border-transparent text-muted hover:text-text"
                }`}
              >
                <span className="truncate">{tab.label}</span>
                {tab.count > 0 && (
                  <span
                    className={`shrink-0 text-[0.6875rem] tabular-nums ${
                      isActive || isSingle ? "text-muted" : "text-muted/60"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {effectiveTab === "space-context" && !space.isDefault && (
          <SpaceContextPanel spaceId={space.id} />
        )}
        {effectiveTab === "files" &&
          hasFiles &&
          (fileChanges.length > 0 ? (
            <FilesPanel
              files={fileChanges}
              cwd=""
              onViewChanges={() => onOpenDiff()}
              onFileClick={(path) => onOpenDiff(path)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center px-4 py-10 text-center text-muted">
              <p className="text-sm">No files changed</p>
            </div>
          ))}
        {effectiveTab === "context" && hasStats && (
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
        )}
      </div>
    </div>
  );
}
