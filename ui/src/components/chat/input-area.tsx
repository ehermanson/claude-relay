import { useContext, useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import type {
  ProviderKind,
  ProviderModelOption,
  ProviderModelOptions,
  ProviderRequest,
  ReasoningEffort,
  UserInputAnswer,
  UserInputQuestion,
} from "@shared/types";
import { getProviderDisplayName } from "@shared/provider-catalog";
import { AskUserQuestionPanel } from "@/components/chat/input-area/ask-user-question-panel";
import { ComposerPanel } from "@/components/chat/input-area/composer-panel";
import { ImageAttachmentStrip } from "@/components/chat/input-area/image-attachment-strip";
import { InputToolbar } from "@/components/chat/input-area/input-toolbar";
import { ProviderSwitchDialog } from "@/components/chat/input-area/provider-switch-dialog";
import { buildModelLabelLookup } from "@/components/chat/input-area/shared";
import { useAttachmentState } from "@/components/chat/input-area/use-attachment-state";
import { useAvailableProviders } from "@/components/chat/input-area/use-available-providers";
import { useComposerMenus } from "@/components/chat/input-area/use-composer-menus";
import { useComposerState } from "@/components/chat/input-area/use-composer-state";
import { useProviderModels } from "@/components/chat/input-area/use-provider-models";
import { useProviderSwitchState } from "@/components/chat/input-area/use-provider-switch-state";
import { ComposerEditorHandle } from "@/components/chat/composer-editor";
import { PlanReviewPanel, type PlanComment } from "@/components/chat/plan-review-card";
import { ProjectContext } from "@/context/project-context";
import { useWSMethods } from "@/context/websocket-context";
import { useMediaQuery } from "@/hooks/use-media-query";
import { formatModel } from "@/lib/utils";
import {
  FastModeToggle,
  PlanModePicker,
  PermissionsToggle,
  ProviderModelPicker,
  ReasoningEffortPicker,
  ReasoningPicker,
} from "@/components/chat/input-area/provider-model-picker";

interface InputAreaProps {
  onSend: (text: string, images?: string[], internal?: boolean) => void;
  onAnswerUserInput?: (requestId: string, answers: Record<string, UserInputAnswer>) => void;
  onCancel: () => void;
  onSwitchProvider?: (
    provider: ProviderKind,
    carryContext: boolean,
    model?: string | null,
  ) => Promise<void> | void;
  isProcessing: boolean;
  isConnected: boolean;
  instanceId: string;
  sessionId?: string;
  isStopped?: boolean;
  /** @deprecated Currently unused but kept for future terminal-pending UI. */
  isPendingInTerminal?: boolean;
  provider: ProviderKind;
  preferredModel?: string;
  reasoningBudget?: number;
  modelOptions?: ProviderModelOptions;
  planMode?: boolean;
  activeModel?: string;
  skipPermissions?: boolean;
  hasMessages?: boolean;
  pendingUserInput?: ProviderRequest | null;
  pendingPlan?: string;
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

export function InputArea({
  onSend,
  onAnswerUserInput,
  onCancel,
  onSwitchProvider,
  isProcessing,
  isConnected,
  instanceId,
  sessionId,
  isStopped,
  isPendingInTerminal,
  provider,
  preferredModel,
  reasoningBudget,
  modelOptions,
  planMode,
  activeModel,
  skipPermissions,
  hasMessages,
  pendingUserInput,
  pendingPlan,
}: InputAreaProps) {
  const composerRef = useRef<ComposerEditorHandle>(null);
  const composerContainerRef = useRef<HTMLDivElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const projectCtx = useContext(ProjectContext);
  const providerSkills = projectCtx?.artifacts.skills.filter((skill) =>
    skill.providers.includes(provider),
  );
  const { send } = useWSMethods();
  const { images, uploading, addImages, removeImage, clearImages, uploadAttachedImages } =
    useAttachmentState();
  const { showModelMenu, setShowModelMenu, availableProviderModels, capabilities } =
    useProviderModels(provider);
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
  } = useComposerState(sessionId, composerRef);
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

  const discoveredProviderModels = availableProviderModels;
  const selectedCustomModel =
    preferredModel && !discoveredProviderModels.some((model) => model.id === preferredModel)
      ? {
          provider,
          id: preferredModel,
          label: preferredModel,
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
  const activeModelLabel = activeModel
    ? (currentProviderModelLabels.get(activeModel) ?? formatModel(activeModel))
    : null;
  const catalogDefaultLabel = currentProviderModels.find((m) => m.isDefault)?.label ?? null;
  const resolvedDefaultLabel = activeModelLabel ?? catalogDefaultLabel ?? "Default";
  const modelLabel = preferredModel
    ? (currentProviderModelLabels.get(preferredModel) ?? preferredModel)
    : resolvedDefaultLabel;
  const supportsModelSelection = capabilities.supportsModelSelection;
  const supportsReasoningSelection = capabilities.supportsReasoningBudget;
  const supportsReasoningEffort = capabilities.supportsReasoningEffort;
  const supportsFastMode = capabilities.supportsFastMode;
  const supportsPlanMode = capabilities.supportsPlanMode;
  const visibleProviders =
    availableProviders.length > 0
      ? availableProviders.some((entry) => entry.provider === provider)
        ? availableProviders
        : [
            {
              provider,
              label: getProviderDisplayName(provider),
              capabilities,
            },
            ...availableProviders,
          ]
      : [
          {
            provider,
            label: getProviderDisplayName(provider),
            capabilities,
          },
        ];
  const providerLabel = provider === "claude" ? "Claude" : getProviderDisplayName(provider);
  const providerSwitchLabel = providerSwitchTarget
    ? providerSwitchTarget === "claude"
      ? "Claude"
      : getProviderDisplayName(providerSwitchTarget)
    : null;

  const setModel = (model: string | null) => {
    send({ type: "set_model", instanceId, model });
  };

  const setReasoningBudget = (budget: number | null) => {
    send({ type: "set_reasoning_budget", instanceId, budget });
  };

  const setPlanMode = (nextPlanMode: boolean) => {
    send({ type: "set_plan_mode", instanceId, planMode: nextPlanMode });
  };

  const setReasoningEffort = (effort: ReasoningEffort | null) => {
    send({ type: "set_model_options", instanceId, modelOptions: { reasoningEffort: effort } });
  };

  const setFastMode = (enabled: boolean) => {
    send({ type: "set_model_options", instanceId, modelOptions: { fastMode: enabled || null } });
  };

  const togglePermissions = () => {
    send({
      type: "set_permissions",
      instanceId,
      skipPermissions: !skipPermissions,
    });
  };

  const handleSend = async () => {
    if (!isConnected || uploading) return;

    const text = draftText.trim();
    if (!text && images.length === 0) return;

    let imagePaths: string[] | undefined;
    try {
      imagePaths = await uploadAttachedImages();
    } catch {
      return;
    }

    onSend(text, imagePaths);
    resetAfterSend();
    clearImages();
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

  const applySlashAction = (action: () => void) => {
    action();
    resetAfterSend();
  };
  const { composerMenu, handleComposerKeyDown } = useComposerMenus({
    instanceId,
    isMobile,
    skills: providerSkills,
    draftText: isInSpecialMode ? "" : draftText,
    composerSelectionOffset: isInSpecialMode ? 0 : composerSelectionOffset,
    mentionEntries,
    selectedMentionKey,
    mentionMenuDismissed,
    selectedSlashKey,
    slashMenuDismissed,
    preferredModel,
    reasoningBudget,
    modelLabel,
    reasoningBudgetLevels: capabilities.reasoningBudgetLevels,
    reasoningEffortLevels: capabilities.reasoningEffortLevels,
    supportsModelSelection,
    supportsReasoningSelection,
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
    setReasoningBudget,
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
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      event.preventDefault();
      addImages(files);
    }
  };

  const disabled = !isConnected;
  const composerDisabled = disabled || (hasPendingPrompt && !allowPromptTextInput);

  const hasPlanFeedback = planFeedbackText.trim().length > 0 || planComments.length > 0;
  const sendIcon = uploading ? (
    <Loader2 size={18} className="animate-spin" />
  ) : (
    <ArrowUp size={18} strokeWidth={2.5} />
  );
  const composerPlaceholder = hasPendingPrompt
    ? buildPromptPlaceholder(primaryPromptQuestion, allowPromptTextInput)
    : hasPendingPlan
      ? "Add feedback to refine the plan, or leave blank to approve"
      : isStopped
        ? "Send a message to resume... Use @ for files and / for commands"
        : "Send a message... Use @ for files and / for commands";
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

  const toolbarControls = [
    supportsModelSelection ? (
      <ProviderModelPicker
        key="model-picker"
        open={showModelMenu}
        onOpenChange={setShowModelMenu}
        isProcessing={isProcessing}
        provider={provider}
        preferredModel={preferredModel}
        availableProviders={visibleProviders}
        currentProviderModels={currentProviderModels}
        modelLabel={modelLabel}
        onSelectModel={setModel}
        onSelectProviderModel={(targetProvider, model) => {
          if (!hasMessages) {
            send({ type: "set_provider", instanceId, provider: targetProvider });
            if (model) send({ type: "set_model", instanceId, model });
          } else {
            setShowModelMenu(false);
            openProviderSwitchDialog(targetProvider, model);
          }
        }}
      />
    ) : null,
    supportsReasoningSelection && capabilities.reasoningBudgetLevels ? (
      <ReasoningPicker
        key="reasoning-picker"
        isProcessing={isProcessing}
        reasoningBudget={reasoningBudget}
        levels={capabilities.reasoningBudgetLevels}
        onSelectReasoningBudget={setReasoningBudget}
      />
    ) : null,
    supportsReasoningEffort && capabilities.reasoningEffortLevels ? (
      <ReasoningEffortPicker
        key="effort-picker"
        isProcessing={isProcessing}
        reasoningEffort={modelOptions?.reasoningEffort}
        levels={capabilities.reasoningEffortLevels}
        onSelectEffort={setReasoningEffort}
      />
    ) : null,
    supportsFastMode && capabilities.fastModes ? (
      <FastModeToggle
        key="fast-mode-toggle"
        isProcessing={isProcessing}
        fastMode={modelOptions?.fastMode}
        modes={capabilities.fastModes}
        onToggle={setFastMode}
      />
    ) : null,
    supportsPlanMode && capabilities.planModes ? (
      <PlanModePicker
        key="plan-mode-toggle"
        isProcessing={isProcessing}
        planMode={planMode}
        modes={capabilities.planModes}
        onTogglePlanMode={setPlanMode}
      />
    ) : null,
    capabilities.permissionModes ? (
      <PermissionsToggle
        key="permissions-toggle"
        isProcessing={isProcessing}
        skipPermissions={skipPermissions}
        modes={capabilities.permissionModes}
        onToggle={togglePermissions}
      />
    ) : null,
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
            addImages(Array.from(event.dataTransfer.files));
          }}
          onDragOver={(event) => event.preventDefault()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files) addImages(Array.from(event.target.files));
              event.target.value = "";
            }}
          />

          <div
            ref={composerContainerRef}
            className="relative rounded-2xl border border-border bg-surface"
          >
            {!isInSpecialMode ? (
              <ImageAttachmentStrip images={images} onRemove={removeImage} />
            ) : null}
            <ComposerPanel
              compact={isMobile}
              disabled={composerDisabled}
              value={composerValue}
              placeholder={composerPlaceholder}
              topContent={composerTopContent}
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
                  controls={isInSpecialMode ? [] : toolbarControls}
                  isProcessing={isProcessing}
                  onCancel={onCancel}
                  onAttachImage={() => fileInputRef.current?.click()}
                  onSend={
                    hasPendingPrompt
                      ? handleSubmitPrompt
                      : hasPendingPlan
                        ? handleApprovePlan
                        : handleSend
                  }
                  sendIcon={sendIcon}
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
                        (!hasPendingPlan && !draftText.trim() && images.length === 0)
                  }
                />
              }
              composerRef={composerRef}
            />
          </div>
        </div>
      </div>
    </>
  );
}
