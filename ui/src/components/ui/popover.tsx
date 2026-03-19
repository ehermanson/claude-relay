import { Popover as BasePopover } from "@base-ui/react/popover";
import { X } from "lucide-react";
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
        <BasePopover.Popup className={`glass z-50 rounded-xl p-4 animate-fade-in ${className}`}>
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
      {children ?? <X size={14} />}
    </BasePopover.Close>
  );
}

export const Popover = {
  Root: PopoverRoot,
  Trigger: PopoverTrigger,
  Content: PopoverContent,
  Close: PopoverClose,
};
