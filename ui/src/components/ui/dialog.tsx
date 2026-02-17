import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function DialogRoot({ open, onOpenChange, children }: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </BaseDialog.Root>
  );
}

interface DialogContentProps {
  children: ReactNode;
  className?: string;
  /** Max-width class. Default: "max-w-2xl" */
  maxWidth?: string;
}

export function DialogContent({
  children,
  className = "",
  maxWidth = "max-w-2xl",
}: DialogContentProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm animate-fade-in" />
      <BaseDialog.Popup className={`fixed inset-0 z-[9999] flex items-center justify-center p-4`}>
        <div
          className={`mx-auto flex w-full ${maxWidth} flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-2xl animate-fade-in ${className}`}
          style={{ maxHeight: "85vh" }}
        >
          {children}
        </div>
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function DialogHeader({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`flex items-center justify-between ${className}`}>{children}</div>;
}

export function DialogTitle({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <BaseDialog.Title className={`text-[0.9375rem] font-semibold text-text-bright ${className}`}>
      {children}
    </BaseDialog.Title>
  );
}

export function DialogClose({ className = "" }: { className?: string }) {
  return (
    <BaseDialog.Close
      className={`flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text ${className}`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </BaseDialog.Close>
  );
}

export const Dialog = {
  Root: DialogRoot,
  Content: DialogContent,
  Header: DialogHeader,
  Title: DialogTitle,
  Close: DialogClose,
};
