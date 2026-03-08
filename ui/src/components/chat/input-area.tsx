import { useRef, useEffect, useState } from "react";
import { ArrowUp, ImagePlus, Loader2, Square } from "lucide-react";
import { useMediaQuery } from "../../hooks/use-media-query";
import { useWSMethods } from "../../context/websocket-context";
import { formatModel } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "../ui/command";
import { Tooltip } from "../ui/tooltip";
import { Menu } from "../ui/menu";
import { uploadImage } from "../../lib/api";

// TODO: Use
const MODELS = [
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
] as const;

const REASONING_LEVELS = [
  { budget: 5000, label: "Low" },
  { budget: 10000, label: "Medium" },
  { budget: 30000, label: "High" },
  { budget: 100000, label: "Max" },
] as const;

const SLASH_COMMANDS = [
  {
    id: "model",
    title: "/model",
    description: "Switch the model used for the next turn",
    category: "Command",
  },
  {
    id: "reasoning",
    title: "/reasoning",
    description: "Set the reasoning budget for the next turn",
    category: "Command",
  },
] as const;

const MODEL_COMMAND_OPTIONS = [
  {
    value: null,
    label: "Default",
    commandValue: "default",
    aliases: ["default", "auto", "system"],
  },
  {
    value: "claude-opus-4-6",
    label: "Opus 4.6",
    commandValue: "opus",
    aliases: ["opus", "opus-4.6", "claude-opus-4-6"],
  },
  {
    value: "claude-sonnet-4-6",
    label: "Sonnet 4.6",
    commandValue: "sonnet",
    aliases: ["sonnet", "sonnet-4.6", "claude-sonnet-4-6"],
  },
  {
    value: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    commandValue: "haiku",
    aliases: ["haiku", "haiku-4.5", "claude-haiku-4-5-20251001"],
  },
] as const;

const REASONING_COMMAND_OPTIONS = [
  {
    value: null,
    label: "Default",
    commandValue: "default",
    aliases: ["default", "auto", "system"],
  },
  ...REASONING_LEVELS.map((level) => ({
    value: level.budget,
    label: level.label,
    commandValue: level.label.toLowerCase(),
    aliases: [level.label.toLowerCase(), String(level.budget)],
  })),
] as const;

interface SlashContext {
  commandQuery: string;
  argQuery: string;
  hasArgument: boolean;
}

interface SlashMenuItem {
  key: string;
  category: string;
  title: string;
  description: string;
  commandText?: string;
  hint?: string;
  actionHint?: string;
  accent?: boolean;
  onSelect: () => void;
}

function getSlashContext(text: string): SlashContext | null {
  const normalized = text.trimStart();
  if (!normalized.startsWith("/") || normalized.includes("\n")) return null;

  const body = normalized.slice(1);
  const firstWhitespace = body.search(/\s/);
  if (firstWhitespace === -1) {
    return {
      commandQuery: body.toLowerCase(),
      argQuery: "",
      hasArgument: false,
    };
  }

  return {
    commandQuery: body.slice(0, firstWhitespace).toLowerCase(),
    argQuery: body
      .slice(firstWhitespace + 1)
      .trimStart()
      .toLowerCase(),
    hasArgument: true,
  };
}

function matchesQuery(query: string, values: readonly string[]): boolean {
  if (!query) return true;
  return values.some((value) => value.includes(query));
}

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
  reasoningBudget?: number;
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
  reasoningBudget,
  activeModel,
  skipPermissions,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [selectedSlashKey, setSelectedSlashKey] = useState<string | null>(null);
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const prevInstanceIdRef = useRef<string>(instanceId);
  const { send } = useWSMethods();

  const setModel = (model: string | null) => {
    send({ type: "set_model", instanceId, model });
  };

  const setReasoningBudget = (budget: number | null) => {
    send({ type: "set_reasoning_budget", instanceId, budget });
  };

  const togglePermissions = () => {
    send({
      type: "set_permissions",
      instanceId,
      skipPermissions: !skipPermissions,
    });
  };

  const activeModelLabel = activeModel
    ? (MODELS.find((m) => m.id === activeModel)?.label ?? formatModel(activeModel))
    : null;
  const modelLabel = preferredModel
    ? (MODELS.find((m) => m.id === preferredModel)?.label ?? preferredModel)
    : (activeModelLabel ?? "Default");
  const defaultMenuLabel = activeModelLabel ? `Default (${activeModelLabel})` : "Default";
  const activeReasoningLevel = REASONING_LEVELS.find((level) => level.budget === reasoningBudget);
  const reasoningLabel = activeReasoningLevel?.label ?? (reasoningBudget ? "Custom" : "Default");

  const adjustTextareaHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = isMobile ? 100 : 140;
    el.style.height = Math.min(el.scrollHeight, max) + "px";
  };

  const updateDraft = (value: string) => {
    setDraftText(value);
    setSlashMenuDismissed(false);
    if (value) {
      drafts.set(instanceId, value);
    } else {
      drafts.delete(instanceId);
    }
  };

  const setComposerValue = (value: string) => {
    updateDraft(value);
    textareaRef.current?.focus();
  };

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [draftText, isMobile]);

  // Save/restore draft text when switching instances
  useEffect(() => {
    const prev = prevInstanceIdRef.current;
    if (prev !== instanceId) {
      // Save draft from previous instance
      const val = draftText;
      if (val) {
        drafts.set(prev, val);
      } else {
        drafts.delete(prev);
      }
      prevInstanceIdRef.current = instanceId;
    }
    // Restore draft for current instance
    const restored = drafts.get(instanceId) || "";
    setDraftText(restored);
    setSlashMenuDismissed(false);
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

    const text = draftText.trim() || textareaRef.current?.value.trim() || "";

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
    updateDraft("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setSelectedSlashKey(null);
    setSlashMenuDismissed(false);
    // Clear image previews
    images.forEach((img) => URL.revokeObjectURL(img.preview));
    setImages([]);
  };

  const applySlashAction = (action: () => void) => {
    action();
    drafts.delete(instanceId);
    setComposerValue("");
    setSelectedSlashKey(null);
    setSlashMenuDismissed(false);
  };

  const slashContext = !isExternal && !slashMenuDismissed ? getSlashContext(draftText) : null;

  const resolveSlashAction = (): (() => void) | null => {
    if (!slashContext || !slashContext.hasArgument) return null;

    if (slashContext.commandQuery === "model") {
      const option = MODEL_COMMAND_OPTIONS.find((item) =>
        item.aliases.some((alias) => alias === slashContext.argQuery),
      );
      return option ? () => setModel(option.value) : null;
    }

    if (slashContext.commandQuery === "reasoning") {
      const option = REASONING_COMMAND_OPTIONS.find((item) =>
        item.aliases.some((alias) => alias === slashContext.argQuery),
      );
      return option ? () => setReasoningBudget(option.value) : null;
    }

    return null;
  };

  const slashMenuItems: SlashMenuItem[] = (() => {
    if (!slashContext) return [];

    if (!slashContext.hasArgument) {
      const commands = SLASH_COMMANDS.filter((command) =>
        matchesQuery(slashContext.commandQuery, [command.id, command.title.slice(1)]),
      );

      return commands.map((command) => ({
        key: command.id,
        category: command.category,
        title: command.title,
        description: command.description,
        commandText: command.title,
        hint: command.id === "model" ? modelLabel : reasoningLabel,
        actionHint: "Tab",
        onSelect: () => setComposerValue(`${command.title} `),
      }));
    }

    if (slashContext.commandQuery === "model") {
      return MODEL_COMMAND_OPTIONS.filter((option) =>
        matchesQuery(slashContext.argQuery, [option.commandValue, option.label.toLowerCase()]),
      ).map((option) => ({
        key: `model-${option.commandValue}`,
        category: "Model",
        title: option.label,
        description: option.value ? option.value : "Uses the active model",
        hint: preferredModel === option.value ? "Current" : undefined,
        actionHint: "Enter",
        accent: preferredModel === option.value,
        onSelect: () => applySlashAction(() => setModel(option.value)),
      }));
    }

    if (slashContext.commandQuery === "reasoning") {
      return REASONING_COMMAND_OPTIONS.filter((option) =>
        matchesQuery(slashContext.argQuery, [option.commandValue, option.label.toLowerCase()]),
      ).map((option) => ({
        key: `reasoning-${option.commandValue}`,
        category: "Reasoning",
        title: option.label,
        description: option.value
          ? `${option.value.toLocaleString()} tokens`
          : "Uses the default budget",
        hint: reasoningBudget === option.value ? "Current" : undefined,
        actionHint: "Enter",
        accent: reasoningBudget === option.value,
        onSelect: () => applySlashAction(() => setReasoningBudget(option.value)),
      }));
    }

    return [];
  })();

  const selectedSlashItem =
    (selectedSlashKey ? slashMenuItems.find((item) => item.key === selectedSlashKey) : null) ??
    slashMenuItems[0] ??
    null;

  useEffect(() => {
    if (slashMenuItems.length === 0) {
      setSelectedSlashKey(null);
      return;
    }

    setSelectedSlashKey((prev) => {
      if (prev && slashMenuItems.some((item) => item.key === prev)) return prev;
      return slashMenuItems[0]?.key ?? null;
    });
  }, [slashContext?.argQuery, slashContext?.hasArgument, slashMenuItems]);

  useEffect(() => {
    if (!slashContext) return;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setSelectedSlashKey(null);
      setSlashMenuDismissed(true);
    };

    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => window.removeEventListener("keydown", handleWindowKeyDown, true);
  }, [slashContext]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (slashMenuItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const currentIndex = selectedSlashItem
          ? slashMenuItems.findIndex((item) => item.key === selectedSlashItem.key)
          : -1;
        const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % slashMenuItems.length;
        setSelectedSlashKey(slashMenuItems[nextIndex]?.key ?? null);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        const currentIndex = selectedSlashItem
          ? slashMenuItems.findIndex((item) => item.key === selectedSlashItem.key)
          : -1;
        const nextIndex =
          currentIndex < 0
            ? slashMenuItems.length - 1
            : (currentIndex - 1 + slashMenuItems.length) % slashMenuItems.length;
        setSelectedSlashKey(slashMenuItems[nextIndex]?.key ?? null);
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        selectedSlashItem?.onSelect();
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const slashAction = resolveSlashAction();
      if (slashAction) {
        applySlashAction(slashAction);
        return;
      }
      if (selectedSlashItem) {
        selectedSlashItem.onSelect();
        return;
      }
      handleSend();
    }
    if (e.key === "Escape") {
      if (slashMenuItems.length > 0) {
        e.preventDefault();
        setSelectedSlashKey(null);
        setSlashMenuDismissed(true);
        return;
      }
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

  const reasoningPickerButton = !isExternal && (
    <Menu.Root>
      <Tooltip content="Set reasoning budget">
        <Menu.Trigger
          disabled={isProcessing}
          className={`flex shrink-0 items-center gap-1 rounded-full p-2 text-xs transition-colors ${
            isProcessing ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-surface-hover"
          } ${reasoningBudget != null ? "text-accent" : "text-muted"}`}
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
            <path d="M9.5 3.5A5.5 5.5 0 0 0 7 14v1a2 2 0 0 0 2 2h.5" />
            <path d="M14.5 3.5A5.5 5.5 0 0 1 17 14v1a2 2 0 0 1-2 2h-.5" />
            <path d="M9 18h6" />
            <path d="M10 21h4" />
            <path d="M12 3v8" />
          </svg>
          <span>{reasoningLabel}</span>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content side="top" align="start">
        <Menu.Item onClick={() => setReasoningBudget(null)}>
          <span className="flex-1">Default</span>
          {reasoningBudget == null && (
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
        {REASONING_LEVELS.map((level) => (
          <Menu.Item key={level.budget} onClick={() => setReasoningBudget(level.budget)}>
            <span className="flex-1">{level.label}</span>
            <span className="mr-2 text-[0.6875rem] text-muted">
              {level.budget.toLocaleString()}
            </span>
            {reasoningBudget === level.budget && (
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

  const slashMenuTitle = !slashContext
    ? ""
    : !slashContext.hasArgument
      ? "Slash commands"
      : slashContext.commandQuery === "model"
        ? "Choose a model"
        : slashContext.commandQuery === "reasoning"
          ? "Choose a reasoning level"
          : "Slash commands";

  const slashMenuSubtitle = !slashContext
    ? ""
    : !slashContext.hasArgument
      ? "Type to filter commands, then press Tab or Enter."
      : "Applies immediately without sending a chat message.";

  const slashGroups = slashMenuItems.reduce<Array<{ heading: string; items: SlashMenuItem[] }>>(
    (groups, item) => {
      const group = groups.find((entry) => entry.heading === item.category);
      if (group) {
        group.items.push(item);
        return groups;
      }
      groups.push({ heading: item.category, items: [item] });
      return groups;
    },
    [],
  );

  const slashMenu = slashContext && (
    <div
      className={`pointer-events-none absolute inset-x-2 z-20 ${isMobile ? "bottom-12" : "bottom-[3.25rem]"}`}
    >
      <div className="pointer-events-auto overflow-hidden rounded-2xl border border-border/80 bg-surface-raised/95 shadow-lg backdrop-blur">
        <div className="flex items-center justify-between border-b border-border/70 px-3 py-1.5">
          <div className="min-w-0">
            <div className="text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-muted">
              {slashMenuTitle}
            </div>
            <div className="truncate pt-0.5 text-[0.6875rem] text-muted">{slashMenuSubtitle}</div>
          </div>
          <div className="ml-3 flex shrink-0 items-center gap-1.5">
            <Badge variant="default" className="px-2 py-0.5 text-[0.6875rem]">
              Esc
            </Badge>
            <span className="text-[0.6875rem] text-muted">dismiss</span>
          </div>
        </div>
        <Command
          shouldFilter={false}
          value={selectedSlashKey ?? undefined}
          onValueChange={setSelectedSlashKey}
          className="bg-transparent p-0"
        >
          <CommandList className="max-h-72 p-1">
            <CommandEmpty>No matching slash commands.</CommandEmpty>
            {slashGroups.map((group, groupIndex) => (
              <div key={group.heading}>
                {groupIndex > 0 ? <CommandSeparator /> : null}
                <CommandGroup heading={group.heading}>
                  {group.items.map((item) => (
                    <CommandItem
                      key={item.key}
                      value={item.key}
                      onMouseEnter={() => setSelectedSlashKey(item.key)}
                      onMouseDown={(e) => e.preventDefault()}
                      onSelect={item.onSelect}
                      className="justify-between gap-2.5 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[0.8125rem] font-medium text-text">
                            {item.title}
                          </span>
                          {item.hint ? (
                            <Badge
                              variant={item.accent ? "accent" : "default"}
                              className="px-2 py-0.5 text-[0.6875rem]"
                            >
                              {item.hint}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="truncate pt-0.5 text-[0.6875rem] text-muted">
                          {item.description}
                        </div>
                      </div>
                      {item.actionHint ? (
                        <CommandShortcut>{item.actionHint}</CommandShortcut>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </div>
            ))}
          </CommandList>
        </Command>
      </div>
    </div>
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

        <div className="relative rounded-2xl border border-border bg-surface">
          {imageStrip}

          {isMobile ? (
            <>
              {/* Mobile: textarea on top, toolbar row below */}
              <textarea
                ref={textareaRef}
                value={draftText}
                placeholder={isStopped ? "Send a message to resume..." : "Send a message..."}
                rows={1}
                disabled={disabled}
                onChange={(e) => updateDraft(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                className={`w-full resize-none overflow-y-auto bg-transparent px-3.5 pt-3 pb-1 text-[16px] leading-normal text-text placeholder:text-muted focus:outline-none ${disabled ? "opacity-40" : ""}`}
                style={{ minHeight: "36px", maxHeight: "100px" }}
              />
              {slashMenu}
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
                  {reasoningPickerButton}
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
                value={draftText}
                placeholder={isStopped ? "Send a message to resume..." : "Send a message..."}
                rows={2}
                disabled={disabled}
                onChange={(e) => updateDraft(e.currentTarget.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                className={`w-full resize-none overflow-y-auto bg-transparent px-4 pt-3 pb-1 text-sm leading-normal text-text placeholder:text-muted focus:outline-none ${disabled ? "opacity-40" : ""}`}
                style={{ minHeight: "52px", maxHeight: "140px" }}
              />
              {slashMenu}
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
                {reasoningPickerButton}
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
