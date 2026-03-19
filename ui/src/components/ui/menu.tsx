import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactNode, ComponentPropsWithoutRef } from "react";

interface MenuProps {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function MenuRoot({ children, open, onOpenChange }: MenuProps) {
  return (
    <BaseMenu.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </BaseMenu.Root>
  );
}

function MenuTrigger({
  children,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"button"> & { children: ReactNode }) {
  return (
    <BaseMenu.Trigger className={className} {...props}>
      {children}
    </BaseMenu.Trigger>
  );
}

interface MenuContentProps {
  children: ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  sideOffset?: number;
}

const popupClass = "glass z-50 min-w-[148px] overflow-hidden rounded-lg py-1 animate-fade-in";

function MenuContent({
  children,
  className = "",
  side = "bottom",
  align = "end",
  sideOffset = 4,
}: MenuContentProps) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner side={side} align={align} sideOffset={sideOffset}>
        <BaseMenu.Popup className={`${popupClass} ${className}`}>{children}</BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

interface MenuItemProps extends ComponentPropsWithoutRef<"div"> {
  children: ReactNode;
  disabled?: boolean;
  /** Show in danger/error color */
  danger?: boolean;
}

const itemBase =
  "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[0.8125rem] transition-colors";

function MenuItem({ children, className = "", danger, disabled, ...props }: MenuItemProps) {
  const colorClass = disabled
    ? "cursor-not-allowed text-muted opacity-40"
    : danger
      ? "text-error hover:bg-surface-hover"
      : "text-text hover:bg-surface-hover";

  return (
    <BaseMenu.Item
      className={`${itemBase} ${colorClass} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </BaseMenu.Item>
  );
}

function MenuSeparator({ className = "" }: { className?: string }) {
  return <div className={`my-1 h-px bg-border ${className}`} role="separator" />;
}

function MenuSub({ children, ...props }: BaseMenu.SubmenuRoot.Props & { children: ReactNode }) {
  return <BaseMenu.SubmenuRoot {...props}>{children}</BaseMenu.SubmenuRoot>;
}

function MenuSubTrigger({
  children,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"div"> & { children: ReactNode }) {
  return (
    <BaseMenu.SubmenuTrigger
      className={`${itemBase} text-text hover:bg-surface-hover data-popup-open:bg-surface-hover ${className}`}
      {...props}
    >
      {children}
    </BaseMenu.SubmenuTrigger>
  );
}

function MenuSubContent({
  children,
  className = "",
  side = "right",
  align = "start",
  sideOffset = 0,
  alignOffset = -4,
}: MenuContentProps & { alignOffset?: number }) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
        <BaseMenu.Popup className={`${popupClass} ${className}`}>{children}</BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

export const Menu = {
  Root: MenuRoot,
  Trigger: MenuTrigger,
  Content: MenuContent,
  Item: MenuItem,
  Separator: MenuSeparator,
  Sub: MenuSub,
  SubTrigger: MenuSubTrigger,
  SubContent: MenuSubContent,
};
