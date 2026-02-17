import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import type { ReactNode, ComponentPropsWithoutRef } from "react";

interface CollapsibleProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

function CollapsibleRoot({ open, defaultOpen, onOpenChange, children }: CollapsibleProps) {
  return (
    <BaseCollapsible.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      {children}
    </BaseCollapsible.Root>
  );
}

function CollapsibleTrigger({
  children,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"button"> & { children: ReactNode }) {
  return (
    <BaseCollapsible.Trigger className={className} {...props}>
      {children}
    </BaseCollapsible.Trigger>
  );
}

interface CollapsibleContentProps {
  children: ReactNode;
  className?: string;
}

function CollapsibleContent({ children, className = "" }: CollapsibleContentProps) {
  return (
    <BaseCollapsible.Panel
      className={`h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 ${className}`}
    >
      {children}
    </BaseCollapsible.Panel>
  );
}

export const Collapsible = {
  Root: CollapsibleRoot,
  Trigger: CollapsibleTrigger,
  Content: CollapsibleContent,
};
