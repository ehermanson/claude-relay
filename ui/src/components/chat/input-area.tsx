import { useRef, useCallback, useEffect, useState } from "react";
import { ArrowUp, ImagePlus, Loader2, Square } from "lucide-react";
import { useMediaQuery } from "../../hooks/use-media-query";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import { uploadImage } from "../../lib/api";

// Persist draft text across instance switches (module-level, survives re-renders)
const drafts = new Map<string, string>();

interface ImageAttachment {
  file: File;
  preview: string;
}

interface InputAreaProps {
  onSend: (text: string, images?: string[]) => void;
  onCancel: () => void;
  isProcessing: boolean;
  isConnected: boolean;
  instanceId: string;
  sessionId?: string;
  isStopped?: boolean;
  isExternal?: boolean;
  isPendingInTerminal?: boolean;
}

export function InputArea({
  onSend,
  onCancel,
  isProcessing,
  isConnected,
  instanceId,
  sessionId,
  isStopped,
  isExternal,
  isPendingInTerminal,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const prevInstanceIdRef = useRef<string>(instanceId);

  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = isMobile ? 100 : 140;
    el.style.height = Math.min(el.scrollHeight, max) + "px";
  }, [isMobile]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Save/restore draft text when switching instances
  useEffect(() => {
    const prev = prevInstanceIdRef.current;
    if (prev !== instanceId) {
      // Save draft from previous instance
      const val = textareaRef.current?.value || "";
      if (val) {
        drafts.set(prev, val);
      } else {
        drafts.delete(prev);
      }
      prevInstanceIdRef.current = instanceId;
    }
    // Restore draft for current instance
    if (textareaRef.current) {
      textareaRef.current.value = drafts.get(instanceId) || "";
      adjustTextareaHeight();
    }
    textareaRef.current?.focus();
  }, [instanceId, adjustTextareaHeight]);

  useEffect(() => {
    setBannerDismissed(false);
  }, [sessionId]);

  const addImages = useCallback((files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    setImages((prev) => [
      ...prev,
      ...imageFiles.map((file) => ({
        file,
        preview: URL.createObjectURL(file),
      })),
    ]);
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      images.forEach((img) => URL.revokeObjectURL(img.preview));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = useCallback(async () => {
    if (!isConnected || uploading) return;

    const text = textareaRef.current?.value.trim() || "";

    if (!text && images.length === 0) return;

    // Upload images first
    let imagePaths: string[] | undefined;
    if (images.length > 0) {
      setUploading(true);
      try {
        imagePaths = await Promise.all(images.map((img) => uploadImage(img.file)));
      } catch {
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    onSend(text, imagePaths);

    // Clear input and draft
    drafts.delete(instanceId);
    if (textareaRef.current) {
      textareaRef.current.value = "";
      textareaRef.current.style.height = "auto";
    }
    // Clear image previews
    images.forEach((img) => URL.revokeObjectURL(img.preview));
    setImages([]);
  }, [onSend, isConnected, images, uploading, instanceId]);

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
    [handleSend, onCancel],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        addImages(files);
      }
    },
    [addImages],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      addImages(files);
    },
    [addImages],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const disabled = !isConnected;
  const showBanner =
    !isMobile &&
    sessionId &&
    !bannerDismissed &&
    !isPendingInTerminal &&
    (isStopped || !isExternal);

  // Round icon button overrides for circular input-area buttons
  const roundIcon = "h-8 w-8 shrink-0 !rounded-full";
  const roundPrimary = "h-8 w-8 shrink-0 !rounded-full !p-0";

  const sendIcon = uploading ? (
    <Loader2 size={18} className="animate-spin" />
  ) : (
    <ArrowUp size={18} strokeWidth={2.5} />
  );

  // Image preview strip (shared)
  const imageStrip = images.length > 0 && (
    <div className="flex flex-wrap gap-2 px-3 pt-3">
      {images.map((img, i) => (
        <div key={i} className="group relative">
          <img
            src={img.preview}
            alt="Attachment"
            className="h-16 w-16 rounded-lg border border-border object-cover"
          />
          <Tooltip content="Remove">
            <button
              onClick={() => removeImage(i)}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-error text-white opacity-0 transition-opacity group-hover:opacity-100"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Tooltip>
        </div>
      ))}
    </div>
  );

  const hiddenFileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      multiple
      className="hidden"
      onChange={(e) => {
        if (e.target.files) addImages(Array.from(e.target.files));
        e.target.value = "";
      }}
    />
  );

  return (
    <div className="shrink-0 safe-area-bottom">
      <div
        className={`mx-auto max-w-3xl ${isMobile ? "px-2 pb-1.5" : "px-6 pb-4"}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {showBanner && (
          <div className="flex items-center gap-2 pb-2">
            <span className="flex-1 text-xs text-muted">
              Resume in terminal:{" "}
              <code className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-xs text-text">
                claude --resume {sessionId}
              </code>
            </span>
            <Tooltip content={copied ? "Copied!" : "Copy command"}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`claude --resume ${sessionId}`);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="flex h-5 w-5 items-center justify-center rounded text-muted transition-colors hover:text-text"
              >
                {copied ? (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-accent"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
            </Tooltip>
            <Tooltip content="Dismiss">
              <button
                onClick={() => setBannerDismissed(true)}
                className="flex h-5 w-5 items-center justify-center rounded text-muted transition-colors hover:text-text"
              >
                <svg
                  width="12"
                  height="12"
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
            </Tooltip>
          </div>
        )}

        {hiddenFileInput}

        <div className="rounded-2xl border border-border bg-surface">
          {imageStrip}

          {isMobile ? (
            <>
              {/* Mobile: textarea on top, toolbar row below */}
              <textarea
                ref={textareaRef}
                placeholder={isStopped ? "Send a message to resume..." : "Send a message..."}
                rows={1}
                disabled={disabled}
                onInput={adjustTextareaHeight}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                className={`w-full resize-none overflow-y-auto bg-transparent px-3.5 pt-3 pb-1 text-[16px] leading-normal text-text placeholder:text-muted focus:outline-none ${disabled ? "opacity-40" : ""}`}
                style={{ minHeight: "36px", maxHeight: "100px" }}
              />
              <div className="flex items-center justify-between px-2 pb-2">
                <div className="flex items-center gap-0.5">
                  <Tooltip content="Attach image">
                    <Button
                      variant="icon"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={disabled}
                      className={roundIcon}
                    >
                      <ImagePlus size={18} />
                    </Button>
                  </Tooltip>
                  {isProcessing && (
                    <Tooltip content="Cancel">
                      <button
                        onClick={onCancel}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-error transition-colors hover:bg-error/10"
                      >
                        <Square size={16} />
                      </button>
                    </Tooltip>
                  )}
                </div>
                <Tooltip content="Send">
                  <Button
                    variant="primary"
                    onClick={handleSend}
                    disabled={disabled || uploading}
                    className={roundPrimary}
                  >
                    {sendIcon}
                  </Button>
                </Tooltip>
              </div>
            </>
          ) : (
            <>
              {/* Desktop: single row — attach | textarea | cancel? | send */}
              <div className="flex items-end gap-1 px-2 py-2">
                <Tooltip content="Attach image">
                  <Button
                    variant="icon"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={disabled}
                    className={roundIcon}
                  >
                    <ImagePlus size={18} />
                  </Button>
                </Tooltip>
                <textarea
                  ref={textareaRef}
                  placeholder={isStopped ? "Send a message to resume..." : "Send a message..."}
                  rows={1}
                  disabled={disabled}
                  onInput={adjustTextareaHeight}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  className={`flex-1 resize-none overflow-y-auto bg-transparent px-2 py-1 text-sm leading-normal text-text placeholder:text-muted focus:outline-none ${disabled ? "opacity-40" : ""}`}
                  style={{ minHeight: "32px", maxHeight: "140px" }}
                />
                {isProcessing && (
                  <Tooltip content="Cancel (Esc)">
                    <button
                      onClick={onCancel}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-error transition-colors hover:bg-error/10"
                    >
                      <Square size={16} />
                    </button>
                  </Tooltip>
                )}
                <Tooltip content="Send (Enter)">
                  <Button
                    variant="primary"
                    onClick={handleSend}
                    disabled={disabled || uploading}
                    className={roundPrimary}
                  >
                    {sendIcon}
                  </Button>
                </Tooltip>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
