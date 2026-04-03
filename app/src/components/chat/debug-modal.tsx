import { Dialog } from "../ui/dialog";
import { ChatDebugTabs } from "./debug-panel";
import type { HistoryEntry, InstanceInfo } from "@shared/types";
import type { ChatItem } from "../../hooks/use-instance-messages";

export function DebugModal({
  instance,
  items,
  rawHistory,
  isProcessing,
  onClose,
}: {
  instance: InstanceInfo;
  items: ChatItem[];
  rawHistory: HistoryEntry[] | null;
  isProcessing: boolean;
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
        />
      </Dialog.Content>
    </Dialog.Root>
  );
}
