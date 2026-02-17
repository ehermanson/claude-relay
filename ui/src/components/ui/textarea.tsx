import { forwardRef, useImperativeHandle, useRef, type TextareaHTMLAttributes } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Auto-resize to content height up to maxHeight (px). Default: no auto-resize. */
  autoResize?: boolean;
  maxHeight?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ autoResize, maxHeight = 140, className = "", onInput, ...props }, ref) => {
    const innerRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => innerRef.current!);

    const adjustHeight = () => {
      const el = innerRef.current;
      if (!el || !autoResize) return;
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
    };

    const handleInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
      adjustHeight();
      onInput?.(e);
    };

    return (
      <textarea
        ref={innerRef}
        onInput={handleInput}
        className={`w-full resize-none overflow-y-auto bg-transparent text-sm leading-normal text-text placeholder:text-muted focus:outline-none ${className}`}
        {...props}
      />
    );
  },
);
