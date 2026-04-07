import { DebugDrawer } from "./debug-drawer";
import { DebugTabs } from "./debug-tabs";
import type { HistoryEntry, InstanceInfo, ProviderGlobalState } from "@shared/types";
import type { ChatItem } from "../../hooks/use-instance-messages";

export function ChatDebug({
  instance,
  items,
  rawHistory,
  isProcessing,
  providerGlobalState,
  onClose,
}: {
  instance: InstanceInfo;
  items: ChatItem[];
  rawHistory: HistoryEntry[] | null;
  isProcessing: boolean;
  providerGlobalState?: ProviderGlobalState;
  onClose: () => void;
}) {
  return (
    <DebugDrawer open title="Debug" onClose={onClose}>
      <DebugTabs
        instance={instance}
        items={items}
        rawHistory={rawHistory}
        isProcessing={isProcessing}
        providerGlobalState={providerGlobalState}
        maxHeight="calc(100vh - 200px)"
        defaultTab="provider"
      />
    </DebugDrawer>
  );
}
