import { useRef, useEffect, useState } from "react";
import { ArrowUp, ImagePlus, Loader2, Square } from "lucide-react";
import { useMediaQuery } from "../../hooks/use-media-query";
import { useWSMethods } from "../../context/websocket-context";
import { formatModel, formatTokens } from "../../lib/utils";
import { BUILTIN_PROVIDER_MODELS, getProviderDisplayName } from "@shared/provider-catalog";
import type { ProviderKind, ProviderModelOption, SessionStats } from "@shared/types";
import { siClaude } from "simple-icons";
import { detectMentionTrigger, replacePromptRange } from "../../lib/composer-mentions";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CheckboxField } from "../ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "../ui/command";
import { Dialog } from "../ui/dialog";
import { FileIcon } from "../ui/file-icon";
import { Tooltip } from "../ui/tooltip";
import { Menu } from "../ui/menu";
import { fetchProviderModels, fetchWorkspaceEntries, uploadImage } from "../../lib/api";
import { ComposerEditor, type ComposerEditorHandle } from "./composer-editor";

const MODELS = BUILTIN_PROVIDER_MODELS.claude;
const CODEX_MODELS = BUILTIN_PROVIDER_MODELS.codex;

const REASONING_LEVELS = [
  {
    budget: 5000,
    label: "Low",
    description: "Fastest responses with light reasoning",
  },
  {
    budget: 10000,
    label: "Medium",
    description: "Balanced depth and speed",
  },
  {
    budget: 30000,
    label: "High",
    description: "More reasoning for harder tasks",
  },
  {
    budget: 100000,
    label: "Max",
    description: "Deepest reasoning, usually slower",
  },
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
    description: "Set the reasoning effort for the next turn",
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

const CODEX_MODEL_COMMAND_OPTIONS = [
  {
    value: null,
    label: "Default",
    commandValue: "default",
    aliases: ["default", "auto", "system"],
  },
  ...CODEX_MODELS.map((model) => ({
    value: model.id,
    label: model.label,
    commandValue: model.id,
    aliases: [model.id, model.label.toLowerCase().replace(/\s+/g, "-")],
  })),
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

const SESSION_PROVIDER_OPTIONS = [
  {
    provider: "codex" as const,
    label: getProviderDisplayName("codex"),
    note: "Managed sessions",
  },
  {
    provider: "claude" as const,
    label: getProviderDisplayName("claude"),
    note: "Managed sessions",
  },
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

const CONTEXT_WINDOW = 200_000;
const OPENAI_BLOSSOM_PATH =
  "M249.176 323.434V298.276C249.176 296.158 249.971 294.569 251.825 293.509L302.406 264.381C309.29 260.409 317.5 258.555 325.973 258.555C357.75 258.555 377.877 283.185 377.877 309.399C377.877 311.253 377.877 313.371 377.611 315.49L325.178 284.771C322.001 282.919 318.822 282.919 315.645 284.771L249.176 323.434ZM367.283 421.415V361.301C367.283 357.592 365.694 354.945 362.516 353.092L296.048 314.43L317.763 301.982C319.617 300.925 321.206 300.925 323.058 301.982L373.639 331.112C388.205 339.586 398.003 357.592 398.003 375.069C398.003 395.195 386.087 413.733 367.283 421.412V421.415ZM233.553 368.452L211.838 355.742C209.986 354.684 209.19 353.095 209.19 350.975V292.718C209.19 264.383 230.905 242.932 260.301 242.932C271.423 242.932 281.748 246.641 290.49 253.26L238.321 283.449C235.146 285.303 233.555 287.951 233.555 291.659V368.455L233.553 368.452ZM280.292 395.462L249.176 377.985V340.913L280.292 323.436L311.407 340.913V377.985L280.292 395.462ZM300.286 475.968C289.163 475.968 278.837 472.259 270.097 465.64L322.264 435.449C325.441 433.597 327.03 430.949 327.03 427.239V350.445L349.011 363.155C350.865 364.213 351.66 365.802 351.66 367.922V426.179C351.66 454.514 329.679 475.965 300.286 475.965V475.968ZM237.525 416.915L186.944 387.785C172.378 379.31 162.582 361.305 162.582 343.827C162.582 323.436 174.763 305.164 193.563 297.485V357.861C193.563 361.571 195.154 364.217 198.33 366.071L264.535 404.467L242.82 416.915C240.967 417.972 239.377 417.972 237.525 416.915ZM234.614 460.343C204.689 460.343 182.71 437.833 182.71 410.028C182.71 407.91 182.976 405.792 183.238 403.672L235.405 433.863C238.582 435.715 241.763 435.715 244.938 433.863L311.407 395.466V420.622C311.407 422.742 310.612 424.331 308.758 425.389L258.179 454.519C251.293 458.491 243.083 460.343 234.611 460.343H234.614ZM300.286 491.854C332.329 491.854 359.073 469.082 365.167 438.892C394.825 431.211 413.892 403.406 413.892 375.073C413.892 356.535 405.948 338.529 391.648 325.552C392.972 319.991 393.766 314.43 393.766 308.87C393.766 271.003 363.048 242.666 327.562 242.666C320.413 242.666 313.528 243.723 306.644 246.109C294.725 234.457 278.307 227.042 260.301 227.042C228.258 227.042 201.513 249.815 195.42 280.004C165.761 287.685 146.694 315.49 146.694 343.824C146.694 362.362 154.638 380.368 168.938 393.344C167.613 398.906 166.819 404.467 166.819 410.027C166.819 447.894 197.538 476.231 233.024 476.231C240.172 476.231 247.058 475.173 253.943 472.788C265.859 484.441 282.278 491.854 300.286 491.854Z";

function ProviderLogo({
  provider,
  className = "",
}: {
  provider: ProviderKind;
  className?: string;
}) {
  if (provider === "claude") {
    return (
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={`fill-current text-[#d97757] ${className}`}
      >
        <path d={siClaude.path} />
      </svg>
    );
  }

  return (
    <svg
      viewBox="140 220 280 280"
      aria-hidden="true"
      className={`fill-current text-text ${className}`}
    >
      <path d={OPENAI_BLOSSOM_PATH} />
    </svg>
  );
}

function ContextRing({ stats }: { stats: SessionStats }) {
  const contextTokens = stats.contextTokens ?? 0;
  if (!contextTokens) return null;

  const pct = Math.min(contextTokens / CONTEXT_WINDOW, 1);
  const used = Math.round(pct * 100);
  const r = 5;
  const size = 14;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - pct);
  const ringColor = pct > 0.9 ? "#ef4444" : pct > 0.7 ? "#f59e0b" : "currentColor";
  const textColor = pct > 0.9 ? "text-error" : pct > 0.7 ? "text-warning" : "text-muted";

  const tooltipContent = (
    <div className="space-y-0.5 text-center">
      <div className="font-semibold text-text">Context window</div>
      <div>
        {used}% used &middot; {100 - used}% left
      </div>
      <div>
        {formatTokens(contextTokens)} / {formatTokens(CONTEXT_WINDOW)} tokens
      </div>
      <div className="pt-1 text-muted">Auto-compacts when full</div>
    </div>
  );

  return (
    <Tooltip content={tooltipContent} delay={200}>
      <button
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-hover ${textColor}`}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Background track */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.2}
            strokeWidth={2}
          />
          {/* Progress arc */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={ringColor}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        </svg>
      </button>
    </Tooltip>
  );
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

function buildModelLabelLookup(models: readonly ProviderModelOption[]): Map<string, string> {
  return new Map(models.map((model) => [model.id, model.label]));
}

// Persist draft text across instance switches (module-level, survives re-renders)
const drafts = new Map<string, string>();

interface ImageAttachment {
  file: File;
  preview: string;
}

interface MentionEntry {
  path: string;
  kind: "file" | "directory";
}

interface InputAreaProps {
  onSend: (text: string, images?: string[]) => void;
  onCancel: () => void;
  onSwitchProvider?: (provider: ProviderKind, carryContext: boolean) => Promise<void> | void;
  isProcessing: boolean;
  isConnected: boolean;
  instanceId: string;
  sessionId?: string;
  isStopped?: boolean;
  isExternal?: boolean;
  isPendingInTerminal?: boolean;
  provider: ProviderKind;
  preferredModel?: string;
  reasoningBudget?: number;
  activeModel?: string;
  skipPermissions?: boolean;
  stats?: SessionStats;
}

export function InputArea({
  onSend,
  onCancel,
  onSwitchProvider,
  isProcessing,
  isConnected,
  instanceId,
  sessionId,
  isStopped,
  isExternal,
  isPendingInTerminal,
  provider,
  preferredModel,
  reasoningBudget,
  activeModel,
  skipPermissions,
  stats,
}: InputAreaProps) {
  const composerRef = useRef<ComposerEditorHandle>(null);
  const composerContainerRef = useRef<HTMLDivElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showProviderSwitchDialog, setShowProviderSwitchDialog] = useState(false);
  const [providerSwitchTarget, setProviderSwitchTarget] = useState<ProviderKind | null>(null);
  const [carryProviderContext, setCarryProviderContext] = useState(true);
  const [providerSwitchError, setProviderSwitchError] = useState("");
  const [isSwitchingProvider, setIsSwitchingProvider] = useState(false);
  const [availableProviderModels, setAvailableProviderModels] = useState<ProviderModelOption[]>([]);
  const [draftText, setDraftText] = useState("");
  const [composerSelectionOffset, setComposerSelectionOffset] = useState(0);
  const [pendingSelectionOffset, setPendingSelectionOffset] = useState<number | null>(null);
  const [mentionEntries, setMentionEntries] = useState<MentionEntry[]>([]);
  const [selectedMentionKey, setSelectedMentionKey] = useState<string | null>(null);
  const [mentionMenuDismissed, setMentionMenuDismissed] = useState(false);
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

  const builtInProviderModels = provider === "codex" ? CODEX_MODELS : MODELS;
  const discoveredProviderModels =
    availableProviderModels.length > 0 ? availableProviderModels : builtInProviderModels;
  const selectedCustomModel =
    preferredModel && !discoveredProviderModels.some((model) => model.id === preferredModel)
      ? {
          provider,
          id: preferredModel,
          label: preferredModel,
        }
      : null;
  const currentProviderModels = selectedCustomModel
    ? [...discoveredProviderModels, selectedCustomModel]
    : discoveredProviderModels;
  const currentProviderModelIds = new Set(currentProviderModels.map((model) => model.id));
  const currentModelOptions =
    provider === "codex"
      ? CODEX_MODEL_COMMAND_OPTIONS.filter(
          (option) => option.value === null || currentProviderModelIds.has(option.value),
        )
      : MODEL_COMMAND_OPTIONS;
  const currentProviderModelLabels = buildModelLabelLookup(currentProviderModels);
  const activeModelLabel = activeModel
    ? (currentProviderModelLabels.get(activeModel) ?? formatModel(activeModel))
    : null;
  const modelLabel = preferredModel
    ? (currentProviderModelLabels.get(preferredModel) ?? preferredModel)
    : (activeModelLabel ?? "Default");
  const defaultMenuLabel = activeModelLabel ? `Default (${activeModelLabel})` : "Default";
  const activeReasoningLevel = REASONING_LEVELS.find((level) => level.budget === reasoningBudget);
  const reasoningLabel = activeReasoningLevel?.label ?? (reasoningBudget ? "Custom" : "Default");
  const supportsModelSelection = true;
  const supportsReasoningSelection = provider === "claude";
  const providerLabel = getProviderDisplayName(provider);
  const providerSwitchLabel = providerSwitchTarget
    ? getProviderDisplayName(providerSwitchTarget)
    : null;

  const openProviderSwitchDialog = (targetProvider: ProviderKind) => {
    if (!onSwitchProvider || targetProvider === provider) return;
    setProviderSwitchTarget(targetProvider);
    setCarryProviderContext(true);
    setProviderSwitchError("");
    setShowProviderSwitchDialog(true);
    setShowModelMenu(false);
  };

  const handleProviderSwitch = async () => {
    if (!providerSwitchTarget || !onSwitchProvider) return;
    setIsSwitchingProvider(true);
    setProviderSwitchError("");

    try {
      await onSwitchProvider(providerSwitchTarget, carryProviderContext);
      setShowProviderSwitchDialog(false);
    } catch (error) {
      setProviderSwitchError(
        error instanceof Error ? error.message : "Failed to start the new provider chat",
      );
    } finally {
      setIsSwitchingProvider(false);
    }
  };

  const updateDraft = (value: string) => {
    setDraftText(value);
    setMentionMenuDismissed(false);
    setSlashMenuDismissed(false);
    if (value) {
      drafts.set(instanceId, value);
    } else {
      drafts.delete(instanceId);
    }
  };

  const setComposerValue = (value: string, selectionOffset = value.length) => {
    updateDraft(value);
    setComposerSelectionOffset(selectionOffset);
    setPendingSelectionOffset(selectionOffset);
    composerRef.current?.focus();
  };

  useEffect(() => {
    composerRef.current?.focus();
  }, []);

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
    setComposerSelectionOffset(restored.length);
    setPendingSelectionOffset(restored.length);
    setMentionEntries([]);
    setSelectedMentionKey(null);
    setMentionMenuDismissed(false);
    setSlashMenuDismissed(false);
    setSelectedSlashKey(null);
    composerRef.current?.focus();
  }, [instanceId]);

  useEffect(() => {
    setBannerDismissed(false);
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;

    if (isExternal) {
      setAvailableProviderModels([]);
      return;
    }

    fetchProviderModels(provider)
      .then((models) => {
        if (!cancelled) {
          setAvailableProviderModels(models.filter((model) => !model.hidden));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailableProviderModels([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isExternal, provider]);

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

    const text = draftText.trim();

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
    setComposerValue("", 0);
    setMentionEntries([]);
    setSelectedMentionKey(null);
    setMentionMenuDismissed(false);
    setSelectedSlashKey(null);
    setSlashMenuDismissed(false);
    // Clear image previews
    images.forEach((img) => URL.revokeObjectURL(img.preview));
    setImages([]);
  };

  const applySlashAction = (action: () => void) => {
    action();
    drafts.delete(instanceId);
    setComposerValue("", 0);
    setMentionEntries([]);
    setSelectedMentionKey(null);
    setMentionMenuDismissed(false);
    setSelectedSlashKey(null);
    setSlashMenuDismissed(false);
  };

  const mentionTrigger = !mentionMenuDismissed
    ? detectMentionTrigger(draftText, composerSelectionOffset)
    : null;

  useEffect(() => {
    if (!mentionTrigger) {
      setMentionEntries([]);
      setSelectedMentionKey(null);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      const result = await fetchWorkspaceEntries(instanceId, mentionTrigger.query);
      if (cancelled) return;
      setMentionEntries(result.entries);
      setSelectedMentionKey((prev) => {
        if (prev && result.entries.some((entry) => entry.path === prev)) return prev;
        return result.entries[0]?.path ?? null;
      });
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [instanceId, mentionTrigger?.query, mentionTrigger?.rangeEnd, mentionTrigger?.rangeStart]);

  const applyMentionEntry = (entry: MentionEntry) => {
    if (!mentionTrigger) return;
    const next = replacePromptRange(
      draftText,
      mentionTrigger.rangeStart,
      mentionTrigger.rangeEnd,
      `@${entry.path} `,
    );
    setComposerValue(next.value, next.cursor);
    setMentionEntries([]);
    setSelectedMentionKey(null);
    setMentionMenuDismissed(false);
  };

  const slashContext = !isExternal && !slashMenuDismissed ? getSlashContext(draftText) : null;

  const slashMenuItems: SlashMenuItem[] = (() => {
    if (!slashContext) return [];

    if (!slashContext.hasArgument) {
      const commands = SLASH_COMMANDS.filter((command) => {
        if (command.id === "model" && !supportsModelSelection) return false;
        if (command.id === "reasoning" && !supportsReasoningSelection) return false;
        return matchesQuery(slashContext.commandQuery, [command.id, command.title.slice(1)]);
      });

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

    if (slashContext.commandQuery === "model" && supportsModelSelection) {
      return currentModelOptions
        .filter((option) =>
          matchesQuery(slashContext.argQuery, [option.commandValue, option.label.toLowerCase()]),
        )
        .map((option) => ({
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

    if (slashContext.commandQuery === "reasoning" && supportsReasoningSelection) {
      return REASONING_COMMAND_OPTIONS.filter((option) =>
        matchesQuery(slashContext.argQuery, [option.commandValue, option.label.toLowerCase()]),
      ).map((option) => ({
        key: `reasoning-${option.commandValue}`,
        category: "Reasoning",
        title: option.label,
        description: option.value
          ? (REASONING_LEVELS.find((level) => level.budget === option.value)?.description ??
            "Custom reasoning effort")
          : "Uses the model default reasoning effort",
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

  const selectedMentionItem =
    (selectedMentionKey
      ? mentionEntries.find((entry) => entry.path === selectedMentionKey)
      : null) ??
    mentionEntries[0] ??
    null;
  const isMentionMenuOpen = !!mentionTrigger;
  const isSlashMenuOpen = !!slashContext;

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
    if (!selectedMentionKey) return;
    const list = mentionListRef.current;
    if (!list) return;

    const frame = requestAnimationFrame(() => {
      const item = list.querySelector<HTMLElement>(
        `[data-menu-item-id="${CSS.escape(selectedMentionKey)}"]`,
      );
      item?.scrollIntoView({ block: "nearest" });
    });

    return () => cancelAnimationFrame(frame);
  }, [mentionEntries, selectedMentionKey]);

  useEffect(() => {
    if (!selectedSlashKey) return;
    const list = slashListRef.current;
    if (!list) return;

    const frame = requestAnimationFrame(() => {
      const item = list.querySelector<HTMLElement>(
        `[data-menu-item-id="${CSS.escape(selectedSlashKey)}"]`,
      );
      item?.scrollIntoView({ block: "nearest" });
    });

    return () => cancelAnimationFrame(frame);
  }, [selectedSlashKey, slashMenuItems]);

  useEffect(() => {
    if (!mentionTrigger && !slashContext) return;

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      const composerContainer = composerContainerRef.current;
      const target = event.target;
      if (composerContainer && target instanceof Node && !composerContainer.contains(target)) {
        return;
      }

      if (mentionTrigger) {
        if (event.key === "Tab" || event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          if (selectedMentionItem) {
            applyMentionEntry(selectedMentionItem);
          }
          return;
        }
      }

      if (slashContext) {
        if (event.key === "Tab" || event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          if (selectedSlashItem) {
            selectedSlashItem.onSelect();
          }
          return;
        }
      }

      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (mentionTrigger) {
        setMentionEntries([]);
        setSelectedMentionKey(null);
        setMentionMenuDismissed(true);
        return;
      }
      setSelectedSlashKey(null);
      setSlashMenuDismissed(true);
    };

    window.addEventListener("keydown", handleWindowKeyDown, true);
    return () => window.removeEventListener("keydown", handleWindowKeyDown, true);
  }, [mentionTrigger, selectedMentionItem, selectedSlashItem, slashContext]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isMentionMenuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (mentionEntries.length === 0) return;
        const currentIndex = selectedMentionItem
          ? mentionEntries.findIndex((entry) => entry.path === selectedMentionItem.path)
          : -1;
        const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % mentionEntries.length;
        setSelectedMentionKey(mentionEntries[nextIndex]?.path ?? null);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (mentionEntries.length === 0) return;
        const currentIndex = selectedMentionItem
          ? mentionEntries.findIndex((entry) => entry.path === selectedMentionItem.path)
          : -1;
        const nextIndex =
          currentIndex < 0
            ? mentionEntries.length - 1
            : (currentIndex - 1 + mentionEntries.length) % mentionEntries.length;
        setSelectedMentionKey(mentionEntries[nextIndex]?.path ?? null);
        return;
      }

      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        if (selectedMentionItem) {
          applyMentionEntry(selectedMentionItem);
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setMentionEntries([]);
        setSelectedMentionKey(null);
        setMentionMenuDismissed(true);
        return;
      }
    }

    if (isSlashMenuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (slashMenuItems.length === 0) return;
        const currentIndex = selectedSlashItem
          ? slashMenuItems.findIndex((item) => item.key === selectedSlashItem.key)
          : -1;
        const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % slashMenuItems.length;
        setSelectedSlashKey(slashMenuItems[nextIndex]?.key ?? null);
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (slashMenuItems.length === 0) return;
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

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (selectedSlashItem) {
          selectedSlashItem.onSelect();
        }
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      if (mentionTrigger) {
        e.preventDefault();
        setMentionEntries([]);
        setSelectedMentionKey(null);
        setMentionMenuDismissed(true);
        return;
      }
      if (isSlashMenuOpen) {
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
  const providerModelPickerButton = !isExternal && supportsModelSelection && (
    <Menu.Root open={showModelMenu} onOpenChange={setShowModelMenu}>
      <Tooltip content="Switch models here, or start a new chat to change providers">
        <Menu.Trigger
          disabled={isProcessing}
          className={`flex shrink-0 items-center gap-2 rounded-full border border-border/80 px-3 py-1.5 text-xs transition-colors ${
            isProcessing
              ? "cursor-not-allowed opacity-40"
              : "cursor-pointer bg-surface hover:bg-surface-hover"
          } ${preferredModel ? "text-accent" : "text-muted"}`}
        >
          <ProviderLogo provider={provider} className="h-4 w-4 shrink-0" />
          <span className="shrink-0 text-text">{providerLabel}</span>
          <span className="max-w-[10rem] truncate text-text">{modelLabel}</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="opacity-70"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content side="top" align="start" className="w-[min(92vw,40rem)] p-0">
        <div className="grid min-w-0 overflow-hidden md:grid-cols-[15rem_minmax(0,1fr)]">
          <div className="border-b border-border bg-surface/60 p-2 md:border-r md:border-b-0">
            <div className="px-2 pb-2 text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-muted">
              Provider
            </div>
            <div className="space-y-1">
              {SESSION_PROVIDER_OPTIONS.map((option) => {
                const isCurrent = option.provider === provider;
                const canSwitch = !isCurrent && !!onSwitchProvider && !isProcessing;
                return (
                  <button
                    key={option.provider}
                    type="button"
                    onClick={() => {
                      if (canSwitch) {
                        openProviderSwitchDialog(option.provider);
                      }
                    }}
                    disabled={!isCurrent && !canSwitch}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors ${
                      isCurrent
                        ? "bg-surface-raised text-text shadow-sm ring-1 ring-border"
                        : canSwitch
                          ? "text-muted hover:bg-surface-hover hover:text-text"
                          : "cursor-not-allowed text-muted opacity-80"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <ProviderLogo provider={option.provider} className="h-5 w-5 shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{option.label}</div>
                        <div className="text-[0.6875rem] text-muted">
                          {isCurrent
                            ? "Active provider for this chat"
                            : `Start a new ${option.label} chat`}
                        </div>
                      </div>
                    </div>
                    {isCurrent ? (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={canSwitch ? "shrink-0 opacity-70" : "shrink-0 opacity-30"}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-2">
            <div className="px-2 pb-2 text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-muted">
              Models
            </div>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => {
                  setModel(null);
                  setShowModelMenu(false);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-text transition-colors hover:bg-surface-hover"
              >
                <div className="min-w-0 flex-1 truncate">{defaultMenuLabel}</div>
                {!preferredModel && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>

              {currentProviderModels.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    setModel(model.id);
                    setShowModelMenu(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-text transition-colors hover:bg-surface-hover"
                >
                  <div className="min-w-0 flex-1 truncate">{model.label}</div>
                  {preferredModel === model.id && (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Menu.Content>
    </Menu.Root>
  );

  const reasoningPickerButton = !isExternal && supportsReasoningSelection && (
    <Menu.Root>
      <Tooltip content="Set reasoning effort">
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
          <span className="flex flex-1 flex-col">
            <span>Default</span>
            <span className="text-[0.6875rem] text-muted">Uses the model default effort</span>
          </span>
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
            <span className="flex flex-1 flex-col">
              <span>{level.label}</span>
              <span className="text-[0.6875rem] text-muted">{level.description}</span>
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
        provider === "codex"
          ? skipPermissions
            ? "Full access — click to use the workspace sandbox"
            : "Workspace sandbox — click for full access"
          : skipPermissions
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
        <span>
          {provider === "codex"
            ? skipPermissions
              ? "Full access"
              : "Sandboxed"
            : skipPermissions
              ? "Full access"
              : "Limited"}
        </span>
      </button>
    </Tooltip>
  );

  const sendIcon = uploading ? (
    <Loader2 size={18} className="animate-spin" />
  ) : (
    <ArrowUp size={18} strokeWidth={2.5} />
  );
  const composerPlaceholder = isStopped
    ? "Send a message to resume... Use @ for files and / for commands"
    : "Send a message... Use @ for files and / for commands";

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

  const mentionMenu = mentionTrigger && (
    <div
      className={`pointer-events-none absolute inset-x-2 z-20 ${isMobile ? "bottom-24" : "bottom-[7rem]"}`}
    >
      <div className="pointer-events-auto overflow-hidden rounded-2xl border border-border/80 bg-surface-raised/95 shadow-lg backdrop-blur">
        <div className="flex items-center justify-between border-b border-border/70 px-3 py-1.5">
          <div className="min-w-0">
            <div className="text-[0.75rem] font-semibold uppercase tracking-[0.12em] text-muted">
              Workspace
            </div>
            <div className="truncate pt-0.5 text-[0.6875rem] text-muted">
              Tag a file or folder for the next turn.
            </div>
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
          value={selectedMentionKey ?? undefined}
          onValueChange={setSelectedMentionKey}
          className="bg-transparent p-0"
        >
          <CommandList ref={mentionListRef} className="max-h-72 p-1">
            <CommandEmpty>No matching files or folders.</CommandEmpty>
            <CommandGroup heading="Workspace">
              {mentionEntries.map((entry) => {
                const basename = entry.path.split("/").pop() || entry.path;
                const parentPath = entry.path.slice(
                  0,
                  Math.max(0, entry.path.length - basename.length - 1),
                );
                return (
                  <CommandItem
                    key={entry.path}
                    value={entry.path}
                    data-menu-item-id={entry.path}
                    onMouseEnter={() => setSelectedMentionKey(entry.path)}
                    onMouseDown={(e) => e.preventDefault()}
                    onSelect={() => applyMentionEntry(entry)}
                    className="justify-between gap-2.5 py-2"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <FileIcon
                        path={entry.path}
                        kind={entry.kind}
                        className="h-3.5 w-3.5 shrink-0"
                      />
                      <div className="min-w-0 flex flex-1 items-baseline gap-2">
                        <div className="truncate text-[0.8125rem] font-medium text-text">
                          {basename}
                        </div>
                        {parentPath ? (
                          <div className="truncate text-[0.75rem] text-muted">{parentPath}</div>
                        ) : null}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
    </div>
  );

  const slashMenu = slashContext && (
    <div
      className={`pointer-events-none absolute inset-x-2 z-20 ${isMobile ? "bottom-24" : "bottom-[7rem]"}`}
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
          <CommandList ref={slashListRef} className="max-h-72 p-1">
            <CommandEmpty>No matching slash commands.</CommandEmpty>
            {slashGroups.map((group, groupIndex) => (
              <div key={group.heading}>
                {groupIndex > 0 ? <CommandSeparator /> : null}
                <CommandGroup heading={group.heading}>
                  {group.items.map((item) => (
                    <CommandItem
                      key={item.key}
                      value={item.key}
                      data-menu-item-id={item.key}
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

  const composerMenu = mentionTrigger ? mentionMenu : slashMenu;

  return (
    <>
      <Dialog.Root
        open={showProviderSwitchDialog}
        onOpenChange={(open) => {
          if (isSwitchingProvider) return;
          setShowProviderSwitchDialog(open);
          if (!open) {
            setProviderSwitchTarget(null);
            setProviderSwitchError("");
            setCarryProviderContext(true);
          }
        }}
      >
        {showProviderSwitchDialog && providerSwitchLabel && (
          <Dialog.Content maxWidth="max-w-lg">
            <Dialog.Header>
              <Dialog.Title>Start a new {providerSwitchLabel} chat?</Dialog.Title>
              <Dialog.Close />
            </Dialog.Header>
            <div className="space-y-3 text-sm text-muted">
              <p>
                Switching providers creates a new chat. Your current {providerLabel} chat stays
                unchanged.
              </p>
              <CheckboxField
                checked={carryProviderContext}
                onCheckedChange={setCarryProviderContext}
                label="Carry over recent conversation context and changed files"
              />
              {providerSwitchError && (
                <div className="rounded-lg border border-error/25 bg-error/5 px-3 py-2 text-[0.8125rem] text-error">
                  {providerSwitchError}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setShowProviderSwitchDialog(false)}
                disabled={isSwitchingProvider}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleProviderSwitch}
                disabled={isSwitchingProvider}
              >
                {isSwitchingProvider ? "Starting..." : `Start ${providerSwitchLabel} chat`}
              </Button>
            </div>
          </Dialog.Content>
        )}
      </Dialog.Root>
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

          <div
            ref={composerContainerRef}
            className="relative rounded-2xl border border-border bg-surface"
          >
            {imageStrip}

            {isMobile ? (
              <>
                <ComposerEditor
                  ref={composerRef}
                  value={draftText}
                  placeholder={composerPlaceholder}
                  placeholderClassName="px-3.5 pt-3 pb-1 text-[15px] leading-normal"
                  disabled={disabled}
                  selectionOffset={pendingSelectionOffset}
                  onSelectionApplied={() => setPendingSelectionOffset(null)}
                  onChange={(value, selectionOffset) => {
                    updateDraft(value);
                    setComposerSelectionOffset(selectionOffset);
                  }}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  className={`min-h-[36px] max-h-[100px] overflow-y-auto bg-transparent px-3.5 pt-3 pb-1 text-[16px] leading-normal text-text outline-none placeholder:text-muted ${disabled ? "opacity-40" : ""}`}
                />
                {composerMenu}
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
                    {providerModelPickerButton}
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
                <ComposerEditor
                  ref={composerRef}
                  value={draftText}
                  placeholder={composerPlaceholder}
                  placeholderClassName="px-4 pt-3 pb-1 text-[13px] leading-normal"
                  disabled={disabled}
                  selectionOffset={pendingSelectionOffset}
                  onSelectionApplied={() => setPendingSelectionOffset(null)}
                  onChange={(value, selectionOffset) => {
                    updateDraft(value);
                    setComposerSelectionOffset(selectionOffset);
                  }}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  className={`min-h-[52px] max-h-[140px] overflow-y-auto bg-transparent px-4 pt-3 pb-1 text-sm leading-normal text-text outline-none placeholder:text-muted ${disabled ? "opacity-40" : ""}`}
                />
                {composerMenu}
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
                  {providerModelPickerButton}
                  {reasoningPickerButton}
                  {permissionsButton}
                  <div className="flex-1" />
                  {stats && <ContextRing stats={stats} />}
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
    </>
  );
}
