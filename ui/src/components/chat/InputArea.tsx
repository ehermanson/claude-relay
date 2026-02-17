import { useRef, useCallback, useEffect } from "react";

interface InputAreaProps {
  onSend: (text: string) => void;
  onCancel: () => void;
  isProcessing: boolean;
  isConnected: boolean;
  isExternal?: boolean;
  onResume?: () => void;
}

export function InputArea({
  onSend,
  onCancel,
  isProcessing,
  isConnected,
  isExternal,
  onResume,
}: InputAreaProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  useEffect(() => {
    if (!isExternal) inputRef.current?.focus();
  }, [isExternal]);

  const handleSend = useCallback(() => {
    const text = inputRef.current?.value.trim();
    if (!text || !isConnected) return;
    onSend(text);
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.style.height = "auto";
    }
  }, [onSend, isConnected]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === "Escape") {
        onCancel();
      }
    },
    [handleSend, onCancel]
  );

  if (isExternal) {
    return (
      <div className="flex shrink-0 items-center justify-center gap-3 border-t border-border bg-surface px-4 py-2.5">
        <span className="text-xs text-muted">
          Monitoring external session (read-only)
        </span>
        {onResume && (
          <button
            onClick={onResume}
            className="rounded border-none bg-claude px-3 py-1.5 font-mono text-xs font-medium text-bg transition-all hover:bg-claude-hover"
          >
            Resume
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border bg-surface px-5 py-3">
      <div className="relative flex flex-1">
        <textarea
          ref={inputRef}
          placeholder="Send a message..."
          rows={1}
          disabled={!isConnected}
          onInput={adjustHeight}
          onKeyDown={handleKeyDown}
          className="w-full resize-none overflow-y-auto rounded border border-border bg-bg px-3 py-[9px] font-mono text-[0.8125rem] leading-normal text-text transition-colors placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_1px_var(--color-accent-dim)] focus:outline-none disabled:opacity-50"
          style={{ minHeight: "38px", maxHeight: "120px" }}
        />
      </div>
      <div className="flex gap-1.5">
        {isProcessing && (
          <button
            onClick={onCancel}
            title="Cancel (Esc)"
            className="flex h-[38px] w-[38px] items-center justify-center rounded border-none bg-error text-white transition-all hover:bg-error-hover"
          >
            <svg
              className="h-[18px] w-[18px]"
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
          </button>
        )}
        <button
          onClick={handleSend}
          disabled={!isConnected}
          title="Send (Enter)"
          className="flex h-[38px] w-[38px] items-center justify-center rounded border-none bg-accent text-bg transition-all hover:bg-accent-hover hover:shadow-[0_0_12px_var(--color-accent-dim)] disabled:cursor-not-allowed disabled:opacity-30"
        >
          <svg
            className="h-[18px] w-[18px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
