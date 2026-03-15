import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import type {
  ProviderKind,
  ProviderRequest,
  UserInputAnswer,
  UserInputQuestion,
} from "@shared/types";
import { getProviderDisplayName } from "@shared/provider-catalog";
import { ProjectContext } from "../../context/project-context";
import { useMediaQuery } from "../../hooks/use-media-query";
import { useWSMethods } from "../../context/websocket-context";
import { formatModel } from "../../lib/utils";
import { ComposerPanel } from "./input-area/composer-panel";
import { ImageAttachmentStrip } from "./input-area/image-attachment-strip";
import { InputToolbar } from "./input-area/input-toolbar";
import { AskUserQuestionPanel } from "./input-area/ask-user-question-panel";
import {
  PlanModePicker,
  PermissionsToggle,
  ProviderModelPicker,
  ReasoningPicker,
} from "./input-area/provider-model-picker";
import { ProviderSwitchDialog } from "./input-area/provider-switch-dialog";
import { buildModelLabelLookup, REASONING_LEVELS } from "./input-area/shared";
import { ComposerEditorHandle } from "./composer-editor";
import { useAttachmentState } from "./input-area/use-attachment-state";
import { useAvailableProviders } from "./input-area/use-available-providers";
import { useComposerMenus } from "./input-area/use-composer-menus";
import { useComposerState } from "./input-area/use-composer-state";
import { useProviderModels } from "./input-area/use-provider-models";
import { useProviderSwitchState } from "./input-area/use-provider-switch-state";

interface InputAreaProps {
  onSend: (text: string, images?: string[]) => void;
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
  isPendingInTerminal?: boolean;
  provider: ProviderKind;
  preferredModel?: string;
  reasoningBudget?: number;
  planMode?: boolean;
  activeModel?: string;
  skipPermissions?: boolean;
  hasMessages?: boolean;
  pendingUserInput?: ProviderRequest | null;
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
  planMode,
  activeModel,
  skipPermissions,
  hasMessages,
  pendingUserInput,
}: InputAreaProps) {
  const composerRef = useRef<ComposerEditorHandle>(null);
  const composerContainerRef = useRef<HTMLDivElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useMediaQuery("(max-width: 768px)");
  const projectCtx = useContext(ProjectContext);
  const providerSkills = useMemo(
    () => projectCtx?.artifacts.skills.filter((s) => s.providers.includes(provider)),
    [projectCtx?.artifacts.skills, provider],
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
  const currentProviderModels = selectedCustomModel
    ? [...discoveredProviderModels, selectedCustomModel]
    : discoveredProviderModels;
  const currentProviderModelIds = new Set(currentProviderModels.map((model) => model.id));
  const currentModelOptions = [
    {
      value: null,
      label: "Default",
      commandValue: "default",
    },
    ...currentProviderModels
      .filter((option) => currentProviderModelIds.has(option.id))
      .map((option) => ({
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
  const activeReasoningLevel = REASONING_LEVELS.find((level) => level.budget === reasoningBudget);
  const reasoningLabel = activeReasoningLevel?.label ?? (reasoningBudget ? "Custom" : "Default");
  const supportsModelSelection = capabilities.supportsModelSelection;
  const supportsReasoningSelection = capabilities.supportsReasoningBudget;
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

  const applySlashAction = (action: () => void) => {
    action();
    resetAfterSend();
  };
  const { composerMenu, handleComposerKeyDown } = useComposerMenus({
    instanceId,
    isMobile,
    skills: providerSkills,
    draftText: hasPendingPrompt ? "" : draftText,
    composerSelectionOffset: hasPendingPrompt ? 0 : composerSelectionOffset,
    mentionEntries,
    selectedMentionKey,
    mentionMenuDismissed,
    selectedSlashKey,
    slashMenuDismissed,
    preferredModel,
    reasoningBudget,
    modelLabel,
    reasoningLabel,
    supportsModelSelection,
    supportsReasoningSelection,
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
    onCancel,
    onSend: hasPendingPrompt ? handleSubmitPrompt : handleSend,
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

  const sendIcon = uploading ? (
    <Loader2 size={18} className="animate-spin" />
  ) : (
    <ArrowUp size={18} strokeWidth={2.5} />
  );
  const composerPlaceholder = hasPendingPrompt
    ? buildPromptPlaceholder(primaryPromptQuestion, allowPromptTextInput)
    : isStopped
      ? "Send a message to resume... Use @ for files and / for commands"
      : "Send a message... Use @ for files and / for commands";
  const composerValue = hasPendingPrompt ? promptText : draftText;
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
  ) : null;
  const sendLabel = hasPendingPrompt
    ? `Submit answer${promptQuestions.length > 1 ? "s" : ""}`
    : undefined;
  const sendTooltip = hasPendingPrompt
    ? `Submit answer${promptQuestions.length > 1 ? "s" : ""}`
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
    supportsReasoningSelection ? (
      <ReasoningPicker
        key="reasoning-picker"
        isProcessing={isProcessing}
        reasoningBudget={reasoningBudget}
        reasoningLabel={reasoningLabel}
        onSelectReasoningBudget={setReasoningBudget}
      />
    ) : null,
    supportsPlanMode ? (
      <PlanModePicker
        key="plan-mode-toggle"
        isProcessing={isProcessing}
        planMode={planMode}
        onTogglePlanMode={setPlanMode}
      />
    ) : null,
    <PermissionsToggle
      key="permissions-toggle"
      provider={provider}
      isProcessing={isProcessing}
      skipPermissions={skipPermissions}
      onToggle={togglePermissions}
    />,
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
            {!hasPendingPrompt ? (
              <ImageAttachmentStrip images={images} onRemove={removeImage} />
            ) : null}
            <ComposerPanel
              compact={isMobile}
              disabled={composerDisabled}
              value={composerValue}
              placeholder={composerPlaceholder}
              topContent={composerTopContent}
              selectionOffset={hasPendingPrompt ? null : pendingSelectionOffset}
              onSelectionApplied={clearPendingSelectionOffset}
              onChange={(value, selectionOffset) => {
                if (hasPendingPrompt) {
                  setPromptText(value);
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
                handleComposerKeyDown(event);
              }}
              onPaste={handlePaste}
              composerMenu={hasPendingPrompt ? null : composerMenu}
              toolbar={
                <InputToolbar
                  isMobile={isMobile}
                  disabled={disabled}
                  showAttachButton={!hasPendingPrompt}
                  controls={toolbarControls}
                  isProcessing={isProcessing}
                  onCancel={onCancel}
                  onAttachImage={() => fileInputRef.current?.click()}
                  onSend={hasPendingPrompt ? handleSubmitPrompt : handleSend}
                  sendIcon={sendIcon}
                  sendLabel={sendLabel}
                  sendTooltip={sendTooltip}
                  secondaryActionLabel={hasPendingPrompt ? "Dismiss" : undefined}
                  onSecondaryAction={hasPendingPrompt ? handleDismissPrompt : undefined}
                  isSecondaryActionDisabled={disabled}
                  isSendDisabled={
                    hasPendingPrompt ? disabled || !canSubmitPrompt : disabled || uploading
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
