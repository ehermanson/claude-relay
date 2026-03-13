import { useState } from "react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";
import type { InstanceInfo } from "@shared/types";
import type { ChatItem } from "../../hooks/use-instance-messages";

export function DebugModal({
  instance,
  items,
  isProcessing,
  onClose,
}: {
  instance: InstanceInfo;
  items: ChatItem[];
  isProcessing: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const debugDump = JSON.stringify({ instance, items, isProcessing }, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(debugDump).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

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
        <pre
          className="flex-1 overflow-auto rounded-lg border border-border bg-bg p-3.5 font-mono text-[0.75rem] leading-relaxed text-text"
          style={{ maxHeight: "55vh" }}
        >
          {debugDump}
        </pre>
        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={handleCopy}
            className={copied ? "bg-accent/15 text-accent hover:bg-accent/25" : ""}
          >
            {copied ? "Copied!" : "Copy to Clipboard"}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
