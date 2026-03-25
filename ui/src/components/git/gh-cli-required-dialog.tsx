import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";

type Reason = "not-installed" | "not-authenticated";

interface GhCliRequiredDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason?: Reason;
}

export function GhCliRequiredDialog({
  open,
  onOpenChange,
  reason = "not-installed",
}: GhCliRequiredDialogProps) {
  const notInstalled = reason === "not-installed";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {open && (
        <Dialog.Content maxWidth="max-w-sm">
          <Dialog.Header>
            <Dialog.Title>
              {notInstalled ? "GitHub CLI Required" : "GitHub CLI Not Authenticated"}
            </Dialog.Title>
            <Dialog.Close />
          </Dialog.Header>
          <div className="space-y-3 text-[0.8125rem] text-muted">
            <p>
              {notInstalled ? (
                <>
                  Creating pull requests requires the{" "}
                  <span className="font-medium text-text">GitHub CLI (gh)</span> to be installed and
                  authenticated.
                </>
              ) : (
                <>
                  The GitHub CLI is installed but not authenticated. You need to log in before
                  creating pull requests.
                </>
              )}
            </p>
            <div className="rounded-lg border border-border bg-bg p-3 space-y-2">
              {notInstalled && (
                <>
                  <p className="text-[0.75rem] font-medium text-text">Install</p>
                  <code className="block text-[0.75rem] text-accent">brew install gh</code>
                  <p className="text-[0.75rem] text-muted">
                    Or see{" "}
                    <a
                      href="https://cli.github.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-text"
                    >
                      cli.github.com
                    </a>{" "}
                    for other install methods.
                  </p>
                </>
              )}
              <p className="text-[0.75rem] font-medium text-text">
                {notInstalled ? "Then authenticate" : "Authenticate"}
              </p>
              <code className="block text-[0.75rem] text-accent">gh auth login</code>
            </div>
            <p className="text-[0.75rem]">
              Your branch was still pushed successfully — you can create the PR manually or try
              again after {notInstalled ? "installing" : "authenticating"}{" "}
              <code className="text-accent">gh</code>.
            </p>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Got it
            </Button>
          </div>
        </Dialog.Content>
      )}
    </Dialog.Root>
  );
}
