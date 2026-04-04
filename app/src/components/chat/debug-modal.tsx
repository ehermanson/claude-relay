import { Dialog } from "../ui/dialog";
import { ChatDebugTabs } from "./debug-panel";
import type { HistoryEntry, InstanceInfo, ProviderGlobalState } from "@shared/types";
import type { ChatItem } from "../../hooks/use-instance-messages";

export function DebugModal({
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
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Debug</Dialog.Title>
          <Dialog.Close />
        </Dialog.Header>

        <ChatDebugTabs
          instance={instance}
          items={items}
          rawHistory={rawHistory}
          isProcessing={isProcessing}
          providerGlobalState={providerGlobalState}
        />
      </Dialog.Content>
    </Dialog.Root>
  );
}
