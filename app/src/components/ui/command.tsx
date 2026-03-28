import { Search, type LucideIcon } from "lucide-react";
import { Command as CommandPrimitive } from "cmdk";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export const Command = forwardRef<
  ElementRef<typeof CommandPrimitive>,
  ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cx(
      "flex h-full w-full flex-col overflow-hidden rounded-xl bg-transparent text-text",
      className,
    )}
    {...props}
  />
));

Command.displayName = CommandPrimitive.displayName;

export const CommandInput = forwardRef<
  ElementRef<typeof CommandPrimitive.Input>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Input> & { icon?: LucideIcon }
>(({ className, icon: Icon = Search, ...props }, ref) => (
  <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2">
    <Icon className="h-4 w-4 shrink-0 text-muted" />
    <CommandPrimitive.Input
      ref={ref}
      className={cx(
        "flex h-8 w-full bg-transparent text-sm text-text outline-none placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  </div>
));

CommandInput.displayName = CommandPrimitive.Input.displayName;

export const CommandList = forwardRef<
  ElementRef<typeof CommandPrimitive.List>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cx("max-h-72 overflow-x-hidden overflow-y-auto", className)}
    {...props}
  />
));

CommandList.displayName = CommandPrimitive.List.displayName;

export const CommandEmpty = forwardRef<
  ElementRef<typeof CommandPrimitive.Empty>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className={cx("py-6 text-center text-sm text-muted", className)}
    {...props}
  />
));

CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

export const CommandGroup = forwardRef<
  ElementRef<typeof CommandPrimitive.Group>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cx(
      "overflow-hidden p-1 text-text **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:text-[0.68rem] **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:tracking-[0.12em] **:[[cmdk-group-heading]]:text-muted",
      className,
    )}
    {...props}
  />
));

CommandGroup.displayName = CommandPrimitive.Group.displayName;

export const CommandSeparator = forwardRef<
  ElementRef<typeof CommandPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cx("-mx-1 my-1 h-px bg-border/70", className)}
    {...props}
  />
));

CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

export const CommandItem = forwardRef<
  ElementRef<typeof CommandPrimitive.Item>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cx(
      "relative flex cursor-default items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm text-text outline-none select-none data-[selected=true]:bg-surface-hover data-[selected=true]:text-text data-[selected=true]:ring-1 data-[selected=true]:ring-border/80 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40",
      className,
    )}
    {...props}
  />
));

CommandItem.displayName = CommandPrimitive.Item.displayName;

export function CommandShortcut({ className, ...props }: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cx("ml-auto text-[0.68rem] uppercase tracking-[0.12em] text-muted", className)}
      {...props}
    />
  );
}
