import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ReactNode, ComponentPropsWithoutRef } from "react";

interface PopoverProps {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function PopoverRoot({ children, open, onOpenChange }: PopoverProps) {
  return (
    <BasePopover.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </BasePopover.Root>
  );
}

function PopoverTrigger({
  children,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"button"> & { children: ReactNode }) {
  return (
    <BasePopover.Trigger className={className} {...props}>
      {children}
    </BasePopover.Trigger>
  );
}

interface PopoverContentProps {
  children: ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
}

function PopoverContent({
  children,
  className = "",
  side = "bottom",
  align = "end",
  sideOffset = 6,
}: PopoverContentProps) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner side={side} align={align} sideOffset={sideOffset}>
        <BasePopover.Popup
          className={`z-50 rounded-xl border border-border bg-surface p-4 shadow-lg animate-fade-in ${className}`}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}

function PopoverClose({ className = "", children }: { className?: string; children?: ReactNode }) {
  return (
    <BasePopover.Close
      className={`flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-surface-hover hover:text-text ${className}`}
    >
      {children ?? (
        <svg
          width="14"
          height="14"
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
      )}
    </BasePopover.Close>
  );
}

export const Popover = {
  Root: PopoverRoot,
  Trigger: PopoverTrigger,
  Content: PopoverContent,
  Close: PopoverClose,
};
