import { useRef, useEffect, useState } from "react";
import { ArrowUp, ImagePlus, Loader2, Square } from "lucide-react";
import { useMediaQuery } from "../../hooks/use-media-query";
import { useWSMethods } from "../../context/websocket-context";
import { formatModel } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import { Menu } from "../ui/menu";
import { uploadImage } from "../../lib/api";

// TODO: Use
const MODELS = [
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
] as const;

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
  preferredModel?: string;
  activeModel?: string;
  skipPermissions?: boolean;
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
  preferredModel,
  activeModel,
  skipPermissions,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const prevInstanceIdRef = useRef<string>(instanceId);
  const { send } = useWSMethods();

  const setModel = (model: string | null) => {
    send({ type: "set_model", instanceId, model });
  };

  const togglePermissions = () => {
    send({ type: "set_permissions", instanceId, skipPermissions: !skipPermissions });
  };

  const activeModelLabel = activeModel
    ? (MODELS.find((m) => m.id === activeModel)?.label ?? formatModel(activeModel))
    : null;
  const modelLabel = preferredModel
    ? (MODELS.find((m) => m.id === preferredModel)?.label ?? preferredModel)
    : (activeModelLabel ?? "Default");
  const defaultMenuLabel = activeModelLabel ? `Default (${activeModelLabel})` : "Default";

  const adjustTextareaHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = isMobile ? 100 : 140;
    el.style.height = Math.min(el.scrollHeight, max) + "px";
  };

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
  }, [instanceId]);

  useEffect(() => {
    setBannerDismissed(false);
  }, [sessionId]);

  const addImages = (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    setImages((prev) => [
      ...prev,
      ...imageFiles.map((file) => ({
        file,
        preview: URL.createObjectURL(file),
      })),
    ]);
  };

  const removeImage = (index: number) => {
    setImages((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      images.forEach((img) => URL.revokeObjectURL(img.preview));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = async () => {
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
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      onCancel();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
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
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    addImages(files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

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

  const modelPickerButton = !isExternal && (
    <Menu.Root>
      <Tooltip content="Select model">
        <Menu.Trigger
          disabled={isProcessing}
          className={`flex shrink-0 items-center gap-1 rounded-full p-2 text-xs transition-colors ${
            isProcessing ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-surface-hover"
          } ${preferredModel ? "text-accent" : "text-muted"}`}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
          </svg>
          <span>{modelLabel}</span>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content side="top" align="start">
        <Menu.Item onClick={() => setModel(null)}>
          <span className="flex-1">{defaultMenuLabel}</span>
          {!preferredModel && (
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </Menu.Item>
        <Menu.Separator />
        {MODELS.map((m) => (
          <Menu.Item key={m.id} onClick={() => setModel(m.id)}>
            <span className="flex-1">{m.label}</span>
            {preferredModel === m.id && (
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Root>
  );

  const permissionsButton = !isExternal && (
    <Tooltip
      content={
        skipPermissions
          ? "Full access — click to require approvals"
          : "Limited — click for full access"
      }
    >
      <button
        onClick={togglePermissions}
        disabled={isProcessing}
        className={`flex shrink-0 items-center gap-1 rounded-full p-2 text-xs transition-colors ${
          isProcessing ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-surface-hover"
        } ${skipPermissions ? "text-accent" : "text-muted"}`}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {skipPermissions ? (
            <>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 9.9-1" />
            </>
          ) : (
            <>
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </>
          )}
        </svg>
        <span>{skipPermissions ? "Full access" : "Limited"}</span>
      </button>
    </Tooltip>
  );

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
                  {modelPickerButton}
                  {permissionsButton}
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
              {/* Desktop: textarea on top, toolbar row below */}
              <textarea
                ref={textareaRef}
                placeholder={isStopped ? "Send a message to resume..." : "Send a message..."}
                rows={2}
                disabled={disabled}
                onInput={adjustTextareaHeight}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                className={`w-full resize-none overflow-y-auto bg-transparent px-4 pt-3 pb-1 text-sm leading-normal text-text placeholder:text-muted focus:outline-none ${disabled ? "opacity-40" : ""}`}
                style={{ minHeight: "52px", maxHeight: "140px" }}
              />
              <div className="flex items-center gap-0.5 px-2 pb-2">
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
                {modelPickerButton}
                {permissionsButton}
                <div className="flex-1" />
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
