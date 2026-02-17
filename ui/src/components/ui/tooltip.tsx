import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { isValidElement, type ReactNode } from "react";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  /** Delay in ms before showing. Default: 400 */
  delay?: number;
}

export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  delay = 400,
}: TooltipProps) {
  if (!content) return <>{children}</>;

  return (
    <BaseTooltip.Provider delay={delay}>
      <BaseTooltip.Root>
        {isValidElement(children) ? (
          <BaseTooltip.Trigger render={children} />
        ) : (
          <BaseTooltip.Trigger render={<span />}>{children}</BaseTooltip.Trigger>
        )}
        <BaseTooltip.Portal>
          <BaseTooltip.Positioner side={side} align={align} sideOffset={6}>
            <BaseTooltip.Popup className="z-[9999] max-w-xs rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-[0.75rem] leading-snug text-text shadow-lg animate-fade-in">
              {content}
            </BaseTooltip.Popup>
          </BaseTooltip.Positioner>
        </BaseTooltip.Portal>
      </BaseTooltip.Root>
    </BaseTooltip.Provider>
  );
}
