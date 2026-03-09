import type { ReactNode } from "react";
import type { ComposerEditorHandle } from "../composer-editor";
import { ComposerEditor } from "../composer-editor";

interface ComposerPanelProps {
  compact: boolean;
  disabled: boolean;
  value: string;
  placeholder: string;
  selectionOffset: number | null;
  onSelectionApplied: () => void;
  onChange: (value: string, selectionOffset: number) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onPaste: (event: React.ClipboardEvent) => void;
  composerMenu: ReactNode;
  toolbar: ReactNode;
  composerRef: React.RefObject<ComposerEditorHandle | null>;
}

export function ComposerPanel({
  compact,
  disabled,
  value,
  placeholder,
  selectionOffset,
  onSelectionApplied,
  onChange,
  onKeyDown,
  onPaste,
  composerMenu,
  toolbar,
  composerRef,
}: ComposerPanelProps) {
  return (
    <>
      <ComposerEditor
        ref={composerRef}
        value={value}
        placeholder={placeholder}
        placeholderClassName={
          compact
            ? "px-3.5 pt-3 pb-1 text-[15px] leading-normal"
            : "px-4 pt-3 pb-1 text-[13px] leading-normal"
        }
        disabled={disabled}
        selectionOffset={selectionOffset}
        onSelectionApplied={onSelectionApplied}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        className={
          compact
            ? `min-h-[36px] max-h-[100px] overflow-y-auto bg-transparent px-3.5 pt-3 pb-1 text-[16px] leading-normal text-text outline-none placeholder:text-muted ${disabled ? "opacity-40" : ""}`
            : `min-h-[52px] max-h-[140px] overflow-y-auto bg-transparent px-4 pt-3 pb-1 text-sm leading-normal text-text outline-none placeholder:text-muted ${disabled ? "opacity-40" : ""}`
        }
      />
      {composerMenu}
      {toolbar}
    </>
  );
}
