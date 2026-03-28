import { Button } from "../../ui/button";
import { CheckboxField } from "../../ui/checkbox";
import { Dialog } from "../../ui/dialog";

interface ProviderSwitchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSwitching: boolean;
  currentProviderLabel: string;
  targetProviderLabel: string | null;
  carryContext: boolean;
  onCarryContextChange: (checked: boolean) => void;
  error: string;
  onConfirm: () => void;
}

export function ProviderSwitchDialog({
  open,
  onOpenChange,
  isSwitching,
  currentProviderLabel,
  targetProviderLabel,
  carryContext,
  onCarryContextChange,
  error,
  onConfirm,
}: ProviderSwitchDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {open && targetProviderLabel && (
        <Dialog.Content maxWidth="max-w-lg">
          <Dialog.Header>
            <Dialog.Title>Start a new {targetProviderLabel} chat?</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <div className="space-y-3 text-sm text-muted">
            <p>
              Switching providers creates a new chat. Your current {currentProviderLabel} chat stays
              unchanged.
            </p>
            <CheckboxField
              checked={carryContext}
              onCheckedChange={onCarryContextChange}
              label="Carry over recent conversation context and changed files"
            />
            {error && (
              <div className="rounded-lg border border-error/25 bg-error/5 px-3 py-2 text-[0.8125rem] text-error">
                {error}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSwitching}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onConfirm} disabled={isSwitching}>
              {isSwitching ? "Starting..." : `Start ${targetProviderLabel} chat`}
            </Button>
          </div>
        </Dialog.Content>
      )}
    </Dialog.Root>
  );
}
