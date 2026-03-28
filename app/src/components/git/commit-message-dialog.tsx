import { useState } from "react";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";

interface CommitMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommit: (message: string) => void;
  /** Placeholder suggestion for the input. */
  placeholder?: string;
}

export function CommitMessageDialog({
  open,
  onOpenChange,
  onCommit,
  placeholder = "Describe your changes…",
}: CommitMessageDialogProps) {
  const [message, setMessage] = useState("");

  const handleCommit = () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    onCommit(trimmed);
    setMessage("");
    onOpenChange(false);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) setMessage("");
        onOpenChange(v);
      }}
    >
      {open && (
        <Dialog.Content maxWidth="max-w-md">
          <Dialog.Header>
            <Dialog.Title>Commit Changes</Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label
                className="text-[0.75rem] font-medium text-muted"
                htmlFor="commit-message-input"
              >
                Commit message
              </label>
              <Input
                id="commit-message-input"
                autoFocus
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCommit();
                }}
                placeholder={placeholder}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" disabled={!message.trim()} onClick={handleCommit}>
                Commit
              </Button>
            </div>
          </div>
        </Dialog.Content>
      )}
    </Dialog.Root>
  );
}
