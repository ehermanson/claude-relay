import type { ReactNode } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";
import { Spinner } from "./spinner";
import { useDelayedPending } from "@/hooks/use-delayed-pending";

interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  cancelLabel?: string;
  maxWidth?: string;
  isLoading?: boolean;
  /** Most confirms guard something destructive; bulk-but-reversible ones don't. */
  confirmVariant?: "danger" | "primary";
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
  isLoading = false,
  confirmVariant = "danger",
}: ConfirmActionDialogProps) {
  // Only show the spinner after the action has been in-flight long enough to perceive.
  // Buttons are disabled immediately (via isLoading) to prevent double-submit.
  const showSpinner = useDelayedPending(isLoading);

  return (
    <Dialog.Root open={open} onOpenChange={isLoading ? () => {} : onOpenChange}>
      {open && (
        <Dialog.Content maxWidth={maxWidth}>
          <Dialog.Header>
            <Dialog.Title>{title}</Dialog.Title>
            {!isLoading && <Dialog.Close />}
          </Dialog.Header>
          <div className="text-[0.8125rem] text-muted">{description}</div>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              {cancelLabel}
            </Button>
            <Button
              variant={confirmVariant}
              size="sm"
              onClick={onConfirm}
              disabled={isLoading}
              className="gap-1.5"
            >
              {showSpinner && <Spinner size={12} className="text-current" />}
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      )}
    </Dialog.Root>
  );
}
