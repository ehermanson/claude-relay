import { useRef } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import type { ProviderKind, SessionStats } from "@shared/types";
import { getProviderDisplayName } from "@shared/provider-catalog";
import { useMediaQuery } from "../../hooks/use-media-query";
import { useWSMethods } from "../../context/websocket-context";
import { formatModel } from "../../lib/utils";
import { ComposerPanel } from "./input-area/composer-panel";
import { ImageAttachmentStrip } from "./input-area/image-attachment-strip";
import { InputToolbar } from "./input-area/input-toolbar";
import {
  PermissionsToggle,
  ProviderModelPicker,
  ReasoningPicker,
} from "./input-area/provider-model-picker";
import { ProviderSwitchDialog } from "./input-area/provider-switch-dialog";
import {
  buildModelLabelLookup,
  CODEX_MODEL_COMMAND_OPTIONS,
  CODEX_MODELS,
  MODEL_COMMAND_OPTIONS,
  REASONING_LEVELS,
  MODELS,
} from "./input-area/shared";
import { ComposerEditorHandle } from "./composer-editor";
import { useAttachmentState } from "./input-area/use-attachment-state";
import { useComposerMenus } from "./input-area/use-composer-menus";
import { useComposerState } from "./input-area/use-composer-state";
import { useProviderModels } from "./input-area/use-provider-models";
import { useProviderSwitchState } from "./input-area/use-provider-switch-state";

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
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { send } = useWSMethods();
  const { images, uploading, addImages, removeImage, clearImages, uploadAttachedImages } =
    useAttachmentState();
  const { showModelMenu, setShowModelMenu, availableProviderModels } = useProviderModels(
    provider,
    isExternal,
  );
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

  const applySlashAction = (action: () => void) => {
    action();
    resetAfterSend();
  };
  const { composerMenu, handleComposerKeyDown } = useComposerMenus({
    instanceId,
    isExternal,
    isMobile,
    draftText,
    composerSelectionOffset,
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
    onSend: handleSend,
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

  const sendIcon = uploading ? (
    <Loader2 size={18} className="animate-spin" />
  ) : (
    <ArrowUp size={18} strokeWidth={2.5} />
  );
  const composerPlaceholder = isStopped
    ? "Send a message to resume... Use @ for files and / for commands"
    : "Send a message... Use @ for files and / for commands";

  const toolbarControls = [
    !isExternal && supportsModelSelection ? (
      <ProviderModelPicker
        key="model-picker"
        open={showModelMenu}
        onOpenChange={setShowModelMenu}
        isProcessing={isProcessing}
        provider={provider}
        preferredModel={preferredModel}
        currentProviderModels={currentProviderModels}
        defaultMenuLabel={defaultMenuLabel}
        modelLabel={modelLabel}
        onSelectModel={setModel}
        onStartProviderSwitch={(targetProvider) => {
          setShowModelMenu(false);
          openProviderSwitchDialog(targetProvider);
        }}
      />
    ) : null,
    !isExternal && supportsReasoningSelection ? (
      <ReasoningPicker
        key="reasoning-picker"
        isProcessing={isProcessing}
        reasoningBudget={reasoningBudget}
        reasoningLabel={reasoningLabel}
        onSelectReasoningBudget={setReasoningBudget}
      />
    ) : null,
    !isExternal ? (
      <PermissionsToggle
        key="permissions-toggle"
        provider={provider}
        isProcessing={isProcessing}
        skipPermissions={skipPermissions}
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
            <ImageAttachmentStrip images={images} onRemove={removeImage} />
            <ComposerPanel
              compact={isMobile}
              disabled={disabled}
              value={draftText}
              placeholder={composerPlaceholder}
              selectionOffset={pendingSelectionOffset}
              onSelectionApplied={clearPendingSelectionOffset}
              onChange={(value, selectionOffset) => {
                updateDraft(value);
                setComposerSelectionOffset(selectionOffset);
              }}
              onKeyDown={handleComposerKeyDown}
              onPaste={handlePaste}
              composerMenu={composerMenu}
              toolbar={
                <InputToolbar
                  isMobile={isMobile}
                  disabled={disabled}
                  stats={stats}
                  controls={toolbarControls}
                  isProcessing={isProcessing}
                  onCancel={onCancel}
                  onAttachImage={() => fileInputRef.current?.click()}
                  onSend={handleSend}
                  sendIcon={sendIcon}
                  isSendDisabled={disabled || uploading}
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
