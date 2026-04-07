import { useEffect, useMemo, useState } from "react";
import { DebugDrawer } from "@/components/chat/debug-drawer";
import { DebugTabs, DataPane, type ExtraTab } from "@/components/chat/debug-tabs";
import { replayHistoryToItems } from "@/hooks/use-instance-messages";
import { fetchInstanceHistory } from "@/lib/api";
import { deriveInstanceStatusPresentation } from "@/lib/utils";
import type { HistoryEntry, InstanceInfo, SpaceInfo } from "@shared/types";

export function SpaceDebug({
  space,
  instances,
  defaultInstanceId,
  onClose,
}: {
  space: SpaceInfo;
  instances: InstanceInfo[];
  defaultInstanceId?: string;
  onClose: () => void;
}) {
  const [selectedChatId, setSelectedChatId] = useState(defaultInstanceId ?? "");
  const [chatHistory, setChatHistory] = useState<HistoryEntry[] | null>(null);
  const [loadingChat, setLoadingChat] = useState(false);

  const selectedInstance = instances.find((i) => i.id === selectedChatId) ?? null;

  // Fetch history when a chat is selected
  useEffect(() => {
    if (!selectedChatId) {
      setChatHistory(null);
      return;
    }
    let cancelled = false;
    setLoadingChat(true);
    setChatHistory(null);
    fetchInstanceHistory(selectedChatId)
      .then((history) => {
        if (!cancelled) setChatHistory(history);
      })
      .catch(() => {
        if (!cancelled) setChatHistory([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingChat(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedChatId]);

  const chatItems = useMemo(
    () => (chatHistory ? replayHistoryToItems(chatHistory) : []),
    [chatHistory],
  );

  const hasChatData = !!selectedInstance && !loadingChat && chatHistory !== null;

  const extraTabs: ExtraTab[] = useMemo(
    () => [
      {
        value: "space",
        label: "Space",
        description:
          "The SpaceInfo object — id, name, project directory, git branch, worktree path, and status.",
        content: (viewMode) => (
          <DataPane data={space} viewMode={viewMode} maxHeight="calc(100vh - 240px)" />
        ),
      },
    ],
    [space],
  );

  return (
    <DebugDrawer open title={`Debug — ${space.name}`} onClose={onClose}>
      {/* Chat picker */}
      {instances.length > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 text-[0.6875rem] font-medium text-muted">Chat</div>
          <div className="flex flex-wrap gap-1.5">
            {instances.map((inst) => {
              const status = deriveInstanceStatusPresentation(inst);
              const isSelected = inst.id === selectedChatId;
              return (
                <button
                  key={inst.id}
                  onClick={() => setSelectedChatId(inst.id)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[0.6875rem] transition-colors ${
                    isSelected
                      ? "border-accent/30 bg-accent/10 font-medium text-text-bright"
                      : "border-border/50 text-muted hover:border-border hover:bg-surface-hover hover:text-text"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dotClass}`} />
                  <span className="max-w-[140px] truncate">{inst.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <DebugTabs
        instance={hasChatData ? selectedInstance : null}
        items={chatItems}
        rawHistory={chatHistory}
        isProcessing={selectedInstance?.status === "processing"}
        extraTabs={extraTabs}
        maxHeight="calc(100vh - 280px)"
        defaultTab={defaultInstanceId ? "provider" : "space"}
        loading={!!selectedChatId && loadingChat}
        emptyMessage={instances.length > 0 ? "Select a chat above to inspect." : undefined}
      />
    </DebugDrawer>
  );
}
