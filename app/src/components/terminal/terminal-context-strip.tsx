/**
 * TerminalContextStrip — Inline chips for attached terminal output.
 *
 * Each attachment renders as a small chip. Click to expand a popover
 * showing the full text. X to remove.
 */

import { X, TerminalSquare } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import type { TerminalContextAttachment } from "@/stores/terminal-store";

interface TerminalContextStripProps {
  attachments: TerminalContextAttachment[];
  onRemove: (id: string) => void;
}

export function TerminalContextStrip({ attachments, onRemove }: TerminalContextStripProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
      {attachments.map((a) => (
        <TerminalChip key={a.id} attachment={a} onRemove={() => onRemove(a.id)} />
      ))}
    </div>
  );
}

function TerminalChip({
  attachment,
  onRemove,
}: {
  attachment: TerminalContextAttachment;
  onRemove: () => void;
}) {
  const lineCount = attachment.text.split("\n").length;

  return (
    <Popover.Root>
      <div className="group flex items-center gap-0 rounded-lg border border-border bg-surface text-[0.6875rem]">
        <Popover.Trigger className="flex items-center gap-1.5 rounded-l-lg py-1 pl-2 pr-1.5 text-text transition-colors hover:bg-surface-hover">
          <TerminalSquare size={12} className="shrink-0 text-muted" />
          <span className="max-w-[10rem] truncate font-medium">{attachment.terminalName}</span>
          <span className="text-muted">
            · {lineCount} line{lineCount !== 1 ? "s" : ""}
          </span>
        </Popover.Trigger>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="flex items-center rounded-r-lg py-1 pl-0.5 pr-1.5 text-muted transition-colors hover:text-text"
        >
          <X size={12} />
        </button>
      </div>
      <Popover.Content
        side="top"
        align="start"
        sideOffset={8}
        className="w-[28rem] max-w-[90vw] p-0"
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <TerminalSquare size={13} className="shrink-0 text-muted" />
          <span className="text-xs font-medium text-text">{attachment.terminalName}</span>
          <span className="text-xs text-muted">
            · {lineCount} line{lineCount !== 1 ? "s" : ""}
          </span>
          <div className="flex-1" />
          <Popover.Close />
        </div>
        <pre className="max-h-60 overflow-auto border-t border-border/40 bg-surface-inset px-3 py-2 font-mono text-[0.6875rem] leading-relaxed text-text/80">
          {attachment.text}
        </pre>
      </Popover.Content>
    </Popover.Root>
  );
}
