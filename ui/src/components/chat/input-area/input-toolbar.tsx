import { Children, type ReactNode } from "react";
import { ImagePlus, Square } from "lucide-react";
import { Button } from "../../ui/button";
import { Tooltip } from "../../ui/tooltip";

interface InputToolbarProps {
  isMobile: boolean;
  disabled: boolean;
  controls: ReactNode[];
  isProcessing: boolean;
  showAttachButton?: boolean;
  onCancel: () => void;
  onAttachImage: () => void;
  onSend: () => void;
  sendIcon: ReactNode;
  sendLabel?: string;
  sendTooltip?: string;
  isSendDisabled: boolean;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  isSecondaryActionDisabled?: boolean;
}

const roundIcon = "h-8 w-8 shrink-0 !rounded-full";
const roundPrimary = "h-8 w-8 shrink-0 !rounded-full !p-0";

export function InputToolbar({
  isMobile,
  disabled,
  controls,
  isProcessing,
  showAttachButton = true,
  onCancel,
  onAttachImage,
  onSend,
  sendIcon,
  sendLabel,
  sendTooltip,
  isSendDisabled,
  secondaryActionLabel,
  onSecondaryAction,
  isSecondaryActionDisabled,
}: InputToolbarProps) {
  const populatedControls = Children.toArray(controls);
  const hasSecondaryAction = !!secondaryActionLabel && !!onSecondaryAction;

  return (
    <div
      className={
        isMobile
          ? "flex items-center justify-between px-2 pb-2"
          : "flex items-center gap-0.5 px-2 pb-2"
      }
    >
      <div className="flex items-center gap-2">
        {showAttachButton ? (
          <Tooltip content="Attach image">
            <Button
              variant="icon"
              onClick={onAttachImage}
              disabled={disabled}
              className={roundIcon}
            >
              <ImagePlus size={18} />
            </Button>
          </Tooltip>
        ) : null}
        {showAttachButton && populatedControls.length > 0 ? (
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border/60" />
        ) : null}
        {populatedControls.map((control, index) => (
          <div key={index} className="flex items-center gap-2">
            {index > 0 ? (
              <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border/60" />
            ) : null}
            {control}
          </div>
        ))}
      </div>

      {!isMobile ? <div className="flex-1" /> : null}
      <div className="flex items-center gap-2">
        {isProcessing ? (
          <Tooltip content={isMobile ? "Cancel" : "Cancel (Esc)"}>
            <button
              onClick={onCancel}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-error transition-colors hover:bg-error/10"
            >
              <Square size={16} />
            </button>
          </Tooltip>
        ) : null}
        {hasSecondaryAction ? (
          <Button
            variant="ghost"
            onClick={onSecondaryAction}
            disabled={isSecondaryActionDisabled}
            className="h-8 shrink-0 rounded-full px-3.5 text-[0.8125rem]"
          >
            {secondaryActionLabel}
          </Button>
        ) : null}
        <Tooltip content={sendTooltip ?? (isMobile ? "Send" : "Send (Enter)")}>
          <Button
            variant="primary"
            onClick={onSend}
            disabled={isSendDisabled}
            className={
              sendLabel
                ? "h-9 shrink-0 rounded-full px-4 text-[0.875rem] font-semibold tracking-[-0.02em]"
                : roundPrimary
            }
          >
            {sendLabel ?? sendIcon}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
