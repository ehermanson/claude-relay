import { useContext, useEffect, useRef, useState } from "react";
import type {
  ProviderSkill,
  ProviderSlashCommand,
  ProviderKind,
  ProviderModelOption,
  ProviderModelOptions,
  ProviderRuntimeMode,
  ProviderStatusSummary,
  ProviderRequest,
  ReasoningEffort,
  UserInputAnswer,
  UserInputQuestion,
} from "@shared/types";
import { getProviderDisplayName } from "@shared/provider-catalog";
import { AskUserQuestionPanel } from "@/components/chat/input-area/ask-user-question-panel";
import { ComposerPanel } from "@/components/chat/input-area/composer-panel";
import { AttachmentStrip } from "@/components/chat/input-area/attachment-strip";
import { classifyAttachment } from "@/components/chat/input-area/shared";
import { InputToolbar, type OverflowSection } from "@/components/chat/input-area/input-toolbar";
import { ProviderSwitchDialog } from "@/components/chat/input-area/provider-switch-dialog";
import { buildModelLabelLookup } from "@/components/chat/input-area/shared";
import { useAttachmentState } from "@/components/chat/input-area/use-attachment-state";
import { useAvailableProviders } from "@/hooks/use-available-providers";
import { useComposerMenus } from "@/components/chat/input-area/use-composer-menus";
import { useComposerState } from "@/components/chat/input-area/use-composer-state";
import { useProviderModels } from "@/hooks/use-provider-models";
import { useProviderSwitchState } from "@/components/chat/input-area/use-provider-switch-state";
import { ComposerEditorHandle } from "@/components/chat/composer-editor";
import { PlanReviewPanel, type PlanComment } from "@/components/chat/plan-review-card";
import type { InlineReplyFragment } from "@/components/chat/message-relay-context";
import { ProjectContext } from "@/context/project-context";
import { useWSMethods } from "@/context/websocket-context";
import { useMediaQuery } from "@/hooks/use-media-query";
import { expandTaskReferences } from "@/lib/composer-mentions";

import { AnimatePresence, motion } from "motion/react";
import { MessageSquareReply, X } from "lucide-react";
import {
  FastModeToggle,
  ProviderModelPicker,
  ReasoningEffortPicker,
  RuntimeModePicker,
} from "@/components/chat/input-area/provider-model-picker";

interface InputAreaProps {
  onSend: (text: string, images?: string[], internal?: boolean, attachments?: string[]) => void;
  onAnswerUserInput?: (requestId: string, answers: Record<string, UserInputAnswer>) => void;
  onCancel: () => void;
  onSwitchProvider?: (
    provider: ProviderKind,
    carryContext: boolean,
    model?: string | null,
  ) => Promise<void> | void;
  isProcessing: boolean;
  isConnected: boolean;
  onReconnect?: () => void;
  instanceId: string;
  isStopped?: boolean;
  provider: ProviderKind;
  preferredModel?: string;
  modelOptions?: ProviderModelOptions;
  runtimeMode?: ProviderRuntimeMode;
  hasMessages?: boolean;
  pendingUserInput?: ProviderRequest | null;
  pendingPlan?: string;
  providerStatus?: ProviderStatusSummary;
  inlineReplyFragments?: InlineReplyFragment[];
  onRemoveInlineReply?: (id: string) => void;
  /** Extra content rendered inside the composer container, above the text input. */
  topSlot?: React.ReactNode;
  /** When set, pre-fills the composer with this text (without sending). Cleared after applying. */
  pendingDraft?: string | null;
  /** Called after pendingDraft has been applied so the parent can clear it. */
  onPendingDraftApplied?: () => void;
  /** Notifies the parent when the composer transitions between empty and non-empty. */
  onDraftChange?: (hasContent: boolean) => void;
  /** Render a narrower review-focused composer with fewer general-purpose controls. */
  mode?: "default" | "review";
}

interface OptimisticProviderSelection {
  provider: ProviderKind;
  preferredModel?: string;
  modelLabel?: string;
}

function buildLegacyProviderSkill(skill: {
  name: string;
  description: string;
  source: "project" | "user" | "system";
  path: string;
}): ProviderSkill {
  return {
    name: skill.name,
    description: skill.description,
    path: skill.path,
    source: skill.source,
    // No invocationPrefix — let the skill appear in both / and $ menus
    enabled: true,
  };
}

function buildPromptPlaceholder(
  question: UserInputQuestion | null,
  allowFreeform: boolean,
): string {
  if (!question) return "";
  if (!allowFreeform) return "Choose an option above to continue";
  if (question.options?.length) {
    return `Type your own answer for "${question.question}", or leave this blank to use the selected option`;
  }
  return `Type your answer for "${question.question}"`;
}

function formatInlineReplyFragment(selectedText: string, reply: string): string {
  // Structured XML tag (matches the `<terminal_context>` / `<task_reference>` convention)
  // so the UI can render quote + reply as distinct visual regions instead of a single
  // markdown blockquote. The model reads this as "user is replying to a quoted excerpt".
  return [
    "<inline_reply>",
    "<quote>",
    selectedText.trim(),
    "</quote>",
    reply.trim(),
    "</inline_reply>",
  ].join("\n");
}

function InlineReplyFragmentStrip({
  fragments,
  onRemove,
}: {
  fragments: InlineReplyFragment[];
  onRemove: (id: string) => void;
}) {
  if (fragments.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 border-b border-border/40 px-3 py-2">
      <AnimatePresence initial={false}>
        {fragments.map((f) => (
          <motion.div
            key={f.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="group flex items-start gap-2 rounded-lg border-l-2 border-accent/40 bg-accent/5 px-2.5 py-1.5">
              <MessageSquareReply size={12} className="mt-0.5 shrink-0 text-accent/60" />
              <div className="min-w-0 flex-1 text-[0.75rem] leading-snug">
                <p className="line-clamp-1 text-muted italic">
                  &ldquo;{f.selectedText.replace(/\n/g, " ")}&rdquo;
                </p>
                <p className="line-clamp-1 text-text/80">{f.reply}</p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(f.id)}
                className="shrink-0 rounded p-0.5 text-muted/60 transition-colors hover:text-text"
                title="Remove reply"
              >
                <X size={12} />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function InputArea({
  onSend,
  onAnswerUserInput,
  onCancel,
  onSwitchProvider,
  isProcessing,
  isConnected,
  instanceId,
  isStopped,
  provider,
  preferredModel,
  modelOptions,
  runtimeMode,
  hasMessages,
  pendingUserInput,
  pendingPlan,
  providerStatus,
  inlineReplyFragments = [],
  onRemoveInlineReply,
  onReconnect,
  topSlot,
  pendingDraft,
  onPendingDraftApplied,
  onDraftChange,
  mode = "default",
}: InputAreaProps) {
  const composerRef = useRef<ComposerEditorHandle>(null);
  const composerContainerRef = useRef<HTMLDivElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [retrying, setRetrying] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const projectCtx = useContext(ProjectContext);
  const { send } = useWSMethods();
  const {
    attachments,
    uploading,
    addFiles,
    removeAttachment,
    clearAttachments,
    uploadAttachedFiles,
  } = useAttachmentState(instanceId);
  const [optimisticProviderSelection, setOptimisticProviderSelection] =
    useState<OptimisticProviderSelection | null>(null);
  const displayedProvider = optimisticProviderSelection?.provider ?? provider;
  const displayedPreferredModel = optimisticProviderSelection?.preferredModel ?? preferredModel;
  const runtimeSlashCommands: ProviderSlashCommand[] =
    providerStatus?.slashCommands?.map((command) => ({
      ...command,
      input: command.input ? { ...command.input } : undefined,
    })) ?? [];
  const runtimeProviderSkills: ProviderSkill[] =
    providerStatus?.skills?.map((skill) => ({ ...skill })) ?? [];
  const artifactProviderSkills =
    projectCtx?.artifacts.skills
      .filter((skill) => skill.providers.includes(displayedProvider))
      .map((skill) => buildLegacyProviderSkill(skill)) ?? [];
  // Merge runtime and artifact skills — runtime wins on name collisions
  const providerSkills = (() => {
    if (runtimeProviderSkills.length === 0) return artifactProviderSkills;
    if (artifactProviderSkills.length === 0) return runtimeProviderSkills;
    const runtimeNames = new Set(runtimeProviderSkills.map((s) => s.name));
    return [
      ...runtimeProviderSkills,
      ...artifactProviderSkills.filter((s) => !runtimeNames.has(s.name)),
    ];
  })();
  const { showModelMenu, setShowModelMenu, availableProviderModels, capabilities, defaultModel } =
    useProviderModels(displayedProvider);
  const { providers: availableProviders } = useAvailableProviders();
  const {
    showProviderSwitchDialog,
    providerSwitchTarget,
    carryProviderContext,
    providerSwitchError,
    isSwitchingProvider,
    openProviderSwitchDialog,
    closeProviderSwitchDialog,
    setCarryProviderContext,
    handleProviderSwitch,
  } = useProviderSwitchState(provider, onSwitchProvider);
  const {
    draftText,
    composerSelectionOffset,
    pendingSelectionOffset,
    mentionEntries,
    selectedMentionKey,
    mentionMenuDismissed,
    selectedSlashKey,
    slashMenuDismissed,
    updateDraft,
    setComposerValue,
    setComposerSelectionOffset,
    clearPendingSelectionOffset,
    setMentionEntries,
    setSelectedMentionKey,
    dismissMentionMenu,
    resetMentionMenu,
    setSelectedSlashKey,
    dismissSlashMenu,
    resetAfterSend,
  } = useComposerState(instanceId, composerRef);
  const [promptText, setPromptText] = useState("");
  const [selectedPromptAnswers, setSelectedPromptAnswers] = useState<Record<string, string>>({});
  const [planComments, setPlanComments] = useState<PlanComment[]>([]);
  const [planFeedbackText, setPlanFeedbackText] = useState("");
  const hasPendingPlan = !!pendingPlan;

  // Reset plan state when pendingPlan changes
  useEffect(() => {
    setPlanComments([]);
    setPlanFeedbackText("");
    if (pendingPlan) {
      composerRef.current?.focus();
    }
  }, [pendingPlan]);

  // Apply pending draft from suggestion cards (pre-fill without sending)
  useEffect(() => {
    if (pendingDraft) {
      setComposerValue(pendingDraft);
      onPendingDraftApplied?.();
    }
  }, [pendingDraft, setComposerValue, onPendingDraftApplied]);

  // Notify parent when the composer transitions between empty / non-empty.
  // Used to dim suggestion cards while a draft is being composed.
  useEffect(() => {
    onDraftChange?.(draftText.trim().length > 0);
  }, [draftText, onDraftChange]);

  const promptRequestId =
    pendingUserInput?.kind === "user_input" ? pendingUserInput.requestId : null;
  const promptQuestions =
    pendingUserInput?.kind === "user_input" ? (pendingUserInput.questions ?? []) : [];
  const hasPendingPrompt = !!promptRequestId && promptQuestions.length > 0;
  const primaryPromptQuestion = promptQuestions[0] ?? null;
  const freeformQuestionId = promptQuestions.find((question) => question.isOther)?.id ?? null;
  const allowPromptTextInput =
    hasPendingPrompt && (!primaryPromptQuestion?.options?.length || !!freeformQuestionId);

  useEffect(() => {
    setPromptText("");
    setSelectedPromptAnswers({});
    if (promptRequestId) {
      composerRef.current?.focus();
    }
  }, [promptRequestId]);

  useEffect(() => {
    setOptimisticProviderSelection((current) => {
      if (!current) return null;
      const currentModel = current.preferredModel ?? null;
      const canonicalModel = preferredModel ?? null;
      if (current.provider === provider && currentModel === canonicalModel) {
        return null;
      }
      return current;
    });
  }, [instanceId, preferredModel, provider]);

  const discoveredProviderModels = availableProviderModels;
  const selectedCustomModel =
    displayedPreferredModel &&
    !discoveredProviderModels.some((model) => model.id === displayedPreferredModel)
      ? {
          provider: displayedProvider,
          id: displayedPreferredModel,
          label: displayedPreferredModel,
        }
      : null;
  const currentProviderModels: ProviderModelOption[] = selectedCustomModel
    ? [...discoveredProviderModels, selectedCustomModel]
    : discoveredProviderModels;
  const currentModelOptions = [
    {
      value: null,
      label: "Default",
      commandValue: "default",
    },
    ...currentProviderModels.map((option) => ({
      value: option.id,
      label: option.label,
      commandValue: option.id,
    })),
  ];
  const currentProviderModelLabels = buildModelLabelLookup(currentProviderModels);
  const resolvedDefaultLabel = defaultModel?.label ?? "Default";
  const modelLabel = displayedPreferredModel
    ? (optimisticProviderSelection?.modelLabel ??
      currentProviderModelLabels.get(displayedPreferredModel) ??
      displayedPreferredModel)
    : resolvedDefaultLabel;
  const selectedModelOption = displayedPreferredModel
    ? currentProviderModels.find((m) => m.id === displayedPreferredModel)
    : defaultModel;
  const effectiveCapabilities = selectedModelOption?.resolvedCapabilities ?? capabilities;
  const supportsModelSelection = effectiveCapabilities.supportsModelSelection;
  const supportsReasoningEffort = effectiveCapabilities.supportsReasoningEffort;
  const supportsFastMode = effectiveCapabilities.supportsFastMode;
  const runtimeModes = effectiveCapabilities.runtimeModes;
  const effectiveRuntimeMode: ProviderRuntimeMode = runtimeMode ?? "approval-required";
  const visibleProviders =
    availableProviders.length > 0
      ? availableProviders.some((entry) => entry.provider === displayedProvider)
        ? availableProviders
        : [
            {
              provider: displayedProvider,
              label: getProviderDisplayName(displayedProvider),
              capabilities,
            },
            ...availableProviders,
          ]
      : [
          {
            provider: displayedProvider,
            label: getProviderDisplayName(displayedProvider),
            capabilities,
          },
        ];
  const providerLabel =
    displayedProvider === "claude" ? "Claude" : getProviderDisplayName(displayedProvider);
  const providerSwitchLabel = providerSwitchTarget
    ? providerSwitchTarget === "claude"
      ? "Claude"
      : getProviderDisplayName(providerSwitchTarget)
    : null;

  const setModel = (model: string | null, label?: string) => {
    setOptimisticProviderSelection({
      provider: displayedProvider,
      preferredModel: model ?? undefined,
      modelLabel: model ? label : undefined,
    });
    send({ type: "set_model", instanceId, model });
  };

  const setRuntimeMode = (mode: ProviderRuntimeMode) => {
    send({ type: "set_runtime_mode", instanceId, mode });
  };

  const setReasoningEffort = (effort: ReasoningEffort | null) => {
    send({ type: "set_model_options", instanceId, modelOptions: { reasoningEffort: effort } });
  };

  const setFastMode = (enabled: boolean) => {
    send({ type: "set_model_options", instanceId, modelOptions: { fastMode: enabled || null } });
  };

  const handleSend = async () => {
    if (!isConnected || uploading) return;

    let text = draftText.trim();
    const hasFragments = inlineReplyFragments.length > 0;
    if (!text && attachments.length === 0 && !hasFragments) return;

    // Prepend inline reply fragments as markdown blockquotes
    if (hasFragments) {
      const fragmentText = inlineReplyFragments
        .map((f) => formatInlineReplyFragment(f.selectedText, f.reply))
        .join("\n\n");
      text = text ? `${fragmentText}\n\n${text}` : fragmentText;
    }

    // Expand task references into structured XML blocks for the model
    const projectTasks = projectCtx?.artifacts.tasks;
    if (projectTasks) {
      text = expandTaskReferences(text, projectTasks);
    }

    let uploaded: { images: string[]; attachments: string[] } | undefined;
    try {
      uploaded = await uploadAttachedFiles();
    } catch {
      return;
    }

    onSend(text, uploaded?.images, undefined, uploaded?.attachments);
    resetAfterSend();
    clearAttachments();
  };

  const promptAnswerForQuestion = (question: UserInputQuestion) => {
    if (freeformQuestionId && question.id === freeformQuestionId) {
      const customAnswer = promptText.trim();
      if (customAnswer) return [customAnswer];
    }
    const selected = selectedPromptAnswers[question.id];
    return selected ? [selected] : [];
  };

  const canSubmitPrompt =
    hasPendingPrompt &&
    promptQuestions.every((question) => promptAnswerForQuestion(question).length > 0);

  const handleSubmitPrompt = () => {
    if (!promptRequestId || !onAnswerUserInput || !canSubmitPrompt) return;
    const answers = Object.fromEntries(
      promptQuestions.map((question) => [
        question.id,
        {
          answers: promptAnswerForQuestion(question),
        },
      ]),
    ) as Record<string, UserInputAnswer>;
    onAnswerUserInput(promptRequestId, answers);
    setPromptText("");
    setSelectedPromptAnswers({});
  };

  const handleDismissPrompt = () => {
    if (!promptRequestId || !onAnswerUserInput) return;
    onAnswerUserInput(promptRequestId, {});
    setPromptText("");
    setSelectedPromptAnswers({});
  };

  const handleApprovePlan = () => {
    const feedback = planFeedbackText.trim();
    if (feedback) {
      // Build structured message with inline comments + typed feedback
      const parts: string[] = [];
      for (const c of planComments) {
        if (c.quotedText) {
          parts.push(`> ${c.quotedText.replace(/\n/g, "\n> ")}\n\nComment: ${c.comment}`);
        } else {
          parts.push(`Comment: ${c.comment}`);
        }
      }
      parts.push(feedback);
      onSend(parts.join("\n\n"), undefined, true);
    } else if (planComments.length > 0) {
      const parts = planComments.map((c) => {
        if (c.quotedText) {
          return `> ${c.quotedText.replace(/\n/g, "\n> ")}\n\nComment: ${c.comment}`;
        }
        return `Comment: ${c.comment}`;
      });
      onSend(
        `I have the following comments on your plan:\n\n${parts.join("\n\n")}\n\nPlease update the plan to address these comments.`,
        undefined,
        true,
      );
    } else {
      onSend("Yes, go ahead with this plan.", undefined, true);
    }
    setPlanFeedbackText("");
    setPlanComments([]);
  };

  const handleDismissPlan = () => {
    onSend("Dismiss this plan.", undefined, true);
    setPlanFeedbackText("");
    setPlanComments([]);
  };

  const isInSpecialMode = hasPendingPrompt || hasPendingPlan;
  const isReviewMode = mode === "review";
  const composerSupportsModelSelection = supportsModelSelection && !isReviewMode;

  const applySlashAction = (action: () => void) => {
    action();
    resetAfterSend();
  };
  const { composerMenu, handleComposerKeyDown } = useComposerMenus({
    instanceId,
    isMobile,
    slashCommands: runtimeSlashCommands,
    skills: providerSkills,
    tasks: projectCtx?.artifacts.tasks ?? null,
    draftText: isInSpecialMode ? "" : draftText,
    composerSelectionOffset: isInSpecialMode ? 0 : composerSelectionOffset,
    mentionEntries,
    selectedMentionKey,
    mentionMenuDismissed,
    selectedSlashKey,
    slashMenuDismissed,
    preferredModel: displayedPreferredModel,
    modelLabel,
    reasoningEffortLevels: effectiveCapabilities.reasoningEffortLevels,
    supportsModelSelection: composerSupportsModelSelection,
    supportsReasoningEffort,
    currentReasoningEffort: modelOptions?.reasoningEffort,
    modelOptions: currentModelOptions,
    composerContainerRef,
    mentionListRef,
    slashListRef,
    setComposerValue,
    setMentionEntries,
    setSelectedMentionKey,
    dismissMentionMenu,
    resetMentionMenu,
    setSelectedSlashKey,
    dismissSlashMenu,
    applySlashAction,
    setModel,
    setReasoningEffort,
    onCancel,
    onSend: hasPendingPrompt ? handleSubmitPrompt : hasPendingPlan ? handleApprovePlan : handleSend,
  });

  const handlePaste = (event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file && classifyAttachment(file) !== null) {
          files.push(file);
        }
      }
    }

    if (files.length > 0) {
      event.preventDefault();
      addFiles(files);
    }
  };

  const disabled = !isConnected;
  const composerDisabled = disabled || (hasPendingPrompt && !allowPromptTextInput);
  const composerHelpText =
    displayedProvider === "codex"
      ? "Use @ for files, / for commands, and $ for skills"
      : displayedProvider === "claude"
        ? "Use @ for files and / for commands and skills"
        : "Use @ for files and / for commands";

  const hasPlanFeedback = planFeedbackText.trim().length > 0 || planComments.length > 0;
  const composerPlaceholder = !isConnected
    ? "Reconnecting to Relay..."
    : hasPendingPrompt
      ? buildPromptPlaceholder(primaryPromptQuestion, allowPromptTextInput)
      : hasPendingPlan
        ? "Add feedback to refine the plan, or leave blank to approve"
        : isStopped
          ? isMobile
            ? "Send a message to resume..."
            : `Send a message to resume... ${composerHelpText}`
          : isMobile
            ? "Send a message..."
            : `Send a message... ${composerHelpText}`;
  const composerValue = hasPendingPrompt
    ? promptText
    : hasPendingPlan
      ? planFeedbackText
      : draftText;
  const composerTopContent = hasPendingPrompt ? (
    <AskUserQuestionPanel
      questions={promptQuestions}
      selectedAnswers={selectedPromptAnswers}
      onSelectOption={(questionId, answer) =>
        setSelectedPromptAnswers((prev) => ({
          ...prev,
          [questionId]: answer,
        }))
      }
    />
  ) : hasPendingPlan ? (
    <PlanReviewPanel
      plan={pendingPlan}
      comments={planComments}
      onCommentsChange={setPlanComments}
    />
  ) : null;
  const composerTopSlot = (
    <>
      {!isInSpecialMode && inlineReplyFragments.length > 0 && onRemoveInlineReply ? (
        <InlineReplyFragmentStrip fragments={inlineReplyFragments} onRemove={onRemoveInlineReply} />
      ) : null}
      {topSlot}
    </>
  );
  const sendLabel = hasPendingPrompt
    ? `Submit answer${promptQuestions.length > 1 ? "s" : ""}`
    : hasPendingPlan
      ? hasPlanFeedback
        ? "Send Feedback"
        : "Approve Plan"
      : undefined;
  const sendTooltip = hasPendingPrompt
    ? `Submit answer${promptQuestions.length > 1 ? "s" : ""}`
    : hasPendingPlan
      ? hasPlanFeedback
        ? "Send feedback (Enter)"
        : "Approve plan (Enter)"
      : undefined;
  const providerPickerProviders = isReviewMode
    ? visibleProviders.filter((entry) => entry.provider === displayedProvider)
    : visibleProviders;

  const toolbarControls = [
    supportsModelSelection ? (
      <ProviderModelPicker
        key="model-picker"
        open={showModelMenu}
        onOpenChange={setShowModelMenu}
        isProcessing={isProcessing}
        provider={displayedProvider}
        preferredModel={displayedPreferredModel}
        availableProviders={providerPickerProviders}
        currentProviderModels={currentProviderModels}
        currentDefaultModelId={defaultModel?.id}
        modelLabel={modelLabel}
        onSelectModel={setModel}
        onSelectProviderModel={(targetProvider, model, label) => {
          if (!hasMessages) {
            setOptimisticProviderSelection({
              provider: targetProvider,
              preferredModel: model ?? undefined,
              modelLabel: model ? label : undefined,
            });
            send({ type: "set_provider", instanceId, provider: targetProvider });
            if (model) send({ type: "set_model", instanceId, model });
          } else {
            setShowModelMenu(false);
            openProviderSwitchDialog(targetProvider, model);
          }
        }}
      />
    ) : null,
    supportsReasoningEffort && effectiveCapabilities.reasoningEffortLevels ? (
      <ReasoningEffortPicker
        key="effort-picker"
        isProcessing={isProcessing}
        reasoningEffort={modelOptions?.reasoningEffort}
        levels={effectiveCapabilities.reasoningEffortLevels}
        onSelectEffort={setReasoningEffort}
      />
    ) : null,
    supportsFastMode && effectiveCapabilities.fastModes ? (
      <FastModeToggle
        key="fast-mode-toggle"
        isProcessing={isProcessing}
        fastMode={modelOptions?.fastMode}
        modes={effectiveCapabilities.fastModes}
        onToggle={setFastMode}
      />
    ) : null,
    runtimeModes ? (
      <RuntimeModePicker
        key="runtime-mode-picker"
        isProcessing={isProcessing}
        runtimeMode={effectiveRuntimeMode}
        modes={runtimeModes}
        onSetRuntimeMode={setRuntimeMode}
      />
    ) : null,
  ];
  const reviewToolbarControls = [
    supportsReasoningEffort && effectiveCapabilities.reasoningEffortLevels ? (
      <ReasoningEffortPicker
        key="effort-picker"
        isProcessing={isProcessing}
        reasoningEffort={modelOptions?.reasoningEffort}
        levels={effectiveCapabilities.reasoningEffortLevels}
        onSelectEffort={setReasoningEffort}
      />
    ) : null,
    supportsFastMode && effectiveCapabilities.fastModes ? (
      <FastModeToggle
        key="fast-mode-toggle"
        isProcessing={isProcessing}
        fastMode={modelOptions?.fastMode}
        modes={effectiveCapabilities.fastModes}
        onToggle={setFastMode}
      />
    ) : null,
  ].filter(Boolean);

  const overflowSections: OverflowSection[] = [
    ...(supportsReasoningEffort && effectiveCapabilities.reasoningEffortLevels
      ? [
          {
            label: "Effort",
            options: [
              {
                label: "Default",
                selected: !modelOptions?.reasoningEffort,
                onSelect: () => setReasoningEffort(null),
              },
              ...effectiveCapabilities.reasoningEffortLevels.map((level) => ({
                label: level.label,
                selected: modelOptions?.reasoningEffort === level.effort,
                onSelect: () => setReasoningEffort(level.effort),
              })),
            ],
          },
        ]
      : []),
    ...(supportsFastMode && effectiveCapabilities.fastModes
      ? [
          {
            label: "Fast Mode",
            options: [
              {
                label: effectiveCapabilities.fastModes.off.label,
                selected: !modelOptions?.fastMode,
                onSelect: () => setFastMode(false),
              },
              {
                label: effectiveCapabilities.fastModes.on.label,
                selected: !!modelOptions?.fastMode,
                onSelect: () => setFastMode(true),
              },
            ],
          },
        ]
      : []),
    ...(runtimeModes
      ? [
          {
            label: "Mode",
            options: (["approval-required", "full-access", "plan"] as ProviderRuntimeMode[])
              .filter((mode) => runtimeModes[mode])
              .map((mode) => {
                const option = runtimeModes[mode]!;
                return {
                  label: option.label,
                  selected: effectiveRuntimeMode === mode,
                  onSelect: () => {
                    if (effectiveRuntimeMode !== mode) setRuntimeMode(mode);
                  },
                };
              }),
          },
        ]
      : []),
  ];
  const reviewOverflowSections: OverflowSection[] = [
    ...(supportsReasoningEffort && effectiveCapabilities.reasoningEffortLevels
      ? [
          {
            label: "Effort",
            options: [
              {
                label: "Default",
                selected: !modelOptions?.reasoningEffort,
                onSelect: () => setReasoningEffort(null),
              },
              ...effectiveCapabilities.reasoningEffortLevels.map((level) => ({
                label: level.label,
                selected: modelOptions?.reasoningEffort === level.effort,
                onSelect: () => setReasoningEffort(level.effort),
              })),
            ],
          },
        ]
      : []),
    ...(supportsFastMode && effectiveCapabilities.fastModes
      ? [
          {
            label: "Fast Mode",
            options: [
              {
                label: effectiveCapabilities.fastModes.off.label,
                selected: !modelOptions?.fastMode,
                onSelect: () => setFastMode(false),
              },
              {
                label: effectiveCapabilities.fastModes.on.label,
                selected: !!modelOptions?.fastMode,
                onSelect: () => setFastMode(true),
              },
            ],
          },
        ]
      : []),
  ];

  return (
    <>
      <ProviderSwitchDialog
        open={showProviderSwitchDialog}
        onOpenChange={(open) => {
          if (!open) closeProviderSwitchDialog();
        }}
        isSwitching={isSwitchingProvider}
        currentProviderLabel={providerLabel}
        targetProviderLabel={providerSwitchLabel}
        carryContext={carryProviderContext}
        onCarryContextChange={setCarryProviderContext}
        error={providerSwitchError}
        onConfirm={handleProviderSwitch}
      />

      <div className="shrink-0 safe-area-bottom">
        <div
          className={`mx-auto max-w-3xl ${isMobile ? "px-2 pb-1.5" : "px-6 pb-4"}`}
          onDrop={(event) => {
            event.preventDefault();
            addFiles(Array.from(event.dataTransfer.files));
          }}
          onDragOver={(event) => event.preventDefault()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,application/json,application/xml,application/yaml,application/sql,text/plain,text/csv,text/markdown,text/html,text/xml,text/yaml,.pdf,.json,.csv,.md,.txt,.log,.html,.yaml,.yml,.xml,.diff,.patch,.sql"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files) addFiles(Array.from(event.target.files));
              event.target.value = "";
            }}
          />

          <div
            ref={composerContainerRef}
            className="@container/toolbar relative rounded-2xl border border-border/60 bg-surface"
          >
            {composerTopSlot}
            {!isInSpecialMode ? (
              <AttachmentStrip attachments={attachments} onRemove={removeAttachment} />
            ) : null}
            <ComposerPanel
              compact={isMobile}
              disabled={composerDisabled}
              value={composerValue}
              placeholder={composerPlaceholder}
              topContent={composerTopContent}
              expanded={!hasMessages && !!composerValue}
              selectionOffset={isInSpecialMode ? null : pendingSelectionOffset}
              onSelectionApplied={clearPendingSelectionOffset}
              onChange={(value, selectionOffset) => {
                if (hasPendingPrompt) {
                  setPromptText(value);
                  return;
                }
                if (hasPendingPlan) {
                  setPlanFeedbackText(value);
                  return;
                }
                updateDraft(value);
                setComposerSelectionOffset(selectionOffset);
              }}
              onKeyDown={(event) => {
                if (hasPendingPrompt) {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handleSubmitPrompt();
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    handleDismissPrompt();
                    return;
                  }
                }
                if (hasPendingPlan) {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handleApprovePlan();
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    handleDismissPlan();
                    return;
                  }
                }
                handleComposerKeyDown(event);
              }}
              onPaste={handlePaste}
              composerMenu={isInSpecialMode ? null : composerMenu}
              toolbar={
                <InputToolbar
                  isMobile={isMobile}
                  disabled={disabled}
                  showAttachButton={!isInSpecialMode}
                  controls={
                    isInSpecialMode ? [] : isReviewMode ? reviewToolbarControls : toolbarControls
                  }
                  overflowSections={
                    isInSpecialMode ? [] : isReviewMode ? reviewOverflowSections : overflowSections
                  }
                  isProcessing={isInSpecialMode ? false : isProcessing}
                  onCancel={onCancel}
                  onAttach={() => fileInputRef.current?.click()}
                  onSend={
                    hasPendingPrompt
                      ? handleSubmitPrompt
                      : hasPendingPlan
                        ? handleApprovePlan
                        : handleSend
                  }
                  sendLabel={sendLabel}
                  sendTooltip={sendTooltip}
                  secondaryActionLabel={
                    hasPendingPrompt ? "Dismiss" : hasPendingPlan ? "Dismiss" : undefined
                  }
                  onSecondaryAction={
                    hasPendingPrompt
                      ? handleDismissPrompt
                      : hasPendingPlan
                        ? handleDismissPlan
                        : undefined
                  }
                  isSecondaryActionDisabled={disabled}
                  isSendDisabled={
                    hasPendingPrompt
                      ? disabled || !canSubmitPrompt
                      : disabled ||
                        uploading ||
                        (!hasPendingPlan &&
                          !draftText.trim() &&
                          attachments.length === 0 &&
                          inlineReplyFragments.length === 0)
                  }
                />
              }
              composerRef={composerRef}
            />
          </div>

          {!isConnected && onReconnect && (
            <div className="flex justify-center pt-1.5">
              <button
                type="button"
                disabled={retrying}
                onClick={() => {
                  if (retrying) return;
                  setRetrying(true);
                  onReconnect();
                  setTimeout(() => setRetrying(false), 3_000);
                }}
                className="text-[0.75rem] text-muted underline-offset-2 hover:text-text-bright hover:underline disabled:opacity-50"
              >
                {retrying ? "Retrying…" : "Retry connection"}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
