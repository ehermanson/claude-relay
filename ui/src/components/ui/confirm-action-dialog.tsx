import type { ReactNode } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";

interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  cancelLabel?: string;
  maxWidth?: string;
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  cancelLabel = "Cancel",
  maxWidth = "max-w-xs",
}: ConfirmActionDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {open && (
        <Dialog.Content maxWidth={maxWidth}>
          <Dialog.Header>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <div className="text-[0.8125rem] text-muted">{description}</div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              {cancelLabel}
            </Button>
            <Button variant="danger" size="sm" onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      )}
    </Dialog.Root>
  );
}
