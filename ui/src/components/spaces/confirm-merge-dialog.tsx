import { GitMerge } from "lucide-react";
import { Dialog } from "../ui/dialog";
import { Button } from "../ui/button";

interface ConfirmMergeDialogProps {
  open: boolean;
  spaceName?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmMergeDialog({
  open,
  spaceName,
  onConfirm,
  onCancel,
}: ConfirmMergeDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onCancel()}>
      <Dialog.Content maxWidth="max-w-lg">
        <Dialog.Header>
          <Dialog.Title>Complete & merge this space?</Dialog.Title>
          <Dialog.Close />
        </Dialog.Header>
        <div className="flex flex-col gap-2 text-sm">
          <p>
            This will take all the work done in{" "}
            {spaceName ? <span className="font-medium text-text">{spaceName}</span> : "this space"}{" "}
            and merge it into your main project branch. Any uncommitted changes in the space will be
            auto-committed before merging.
          </p>
          <p>
            Once merged, the space's separate working copy will be removed — the changes will live
            in your main branch going forward. This cannot be undone.
          </p>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onConfirm} className="gap-1.5">
            <GitMerge className="size-4" />
            Merge
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
