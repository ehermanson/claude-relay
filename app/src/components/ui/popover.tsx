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

type PopoverTriggerProps = ComponentPropsWithoutRef<typeof BasePopover.Trigger> & {
  children?: ReactNode;
};

function PopoverTrigger({ children, className = "", ...props }: PopoverTriggerProps) {
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
  /** Optional anchor element for positioning when no Trigger is used. */
  anchor?: Element | null;
}

function PopoverContent({
  children,
  className = "",
  side = "bottom",
  align = "end",
  sideOffset = 6,
  anchor,
}: PopoverContentProps) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner side={side} align={align} sideOffset={sideOffset} anchor={anchor}>
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
