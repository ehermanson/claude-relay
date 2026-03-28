import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { StatusDot } from "@/components/ui/status-dot";
import { instanceStatusVariant } from "@/lib/utils";
import type { InstanceInfo, SpaceInfo } from "@shared/types";

export function SpaceDebugModal({
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
  const [selectedId, setSelectedId] = useState(defaultInstanceId ?? instances[0]?.id ?? "");
  const [copied, setCopied] = useState(false);

  const selectedInstance = instances.find((instance) => instance.id === selectedId);
  const debugDump = JSON.stringify({ space, instance: selectedInstance ?? null }, null, 2);

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
      <Dialog.Content maxWidth="max-w-3xl">
        <Dialog.Header>
          <Dialog.Title>Debug - {space.name}</Dialog.Title>
          <Dialog.Close />
        </Dialog.Header>
        {instances.length > 1 && (
          <div className="flex gap-1 rounded-lg bg-bg p-1">
            {instances.map((instance) => (
              <button
                key={instance.id}
                onClick={() => setSelectedId(instance.id)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.75rem] font-medium transition-colors ${
                  selectedId === instance.id
                    ? "bg-surface-hover text-text-bright"
                    : "text-muted hover:text-text"
                }`}
              >
                <StatusDot variant={instanceStatusVariant(instance.status)} />
                <span className="max-w-[120px] truncate">{instance.name}</span>
              </button>
            ))}
          </div>
        )}
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
