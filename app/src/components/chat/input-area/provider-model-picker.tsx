import {
  BrainIcon,
  Check,
  ChevronRight,
  LockIcon,
  LockOpenIcon,
  MapIcon,
  ZapIcon,
} from "lucide-react";
import type {
  ControlOption,
  ProviderDescriptor,
  ProviderKind,
  ProviderModelOption,
  ProviderRuntimeMode,
  ReasoningEffort,
} from "@shared/types";
import { BUILTIN_PROVIDER_MODELS, getProviderDisplayName } from "@shared/provider-catalog";
import { Menu } from "../../ui/menu";
import { Tooltip } from "../../ui/tooltip";
import { ProviderLogo } from "@/components/ui/provider-logo";

interface ProviderModelPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isProcessing: boolean;
  provider: ProviderKind;
  preferredModel?: string;
  availableProviders: ProviderDescriptor[];
  currentProviderModels: ProviderModelOption[];
  currentDefaultModelId?: string;
  modelLabel: string;
  onSelectModel: (model: string | null, label?: string) => void;
  /** Called when user selects a model from a different provider's panel */
  onSelectProviderModel?: (provider: ProviderKind, model: string | null, label?: string) => void;
}

export function ProviderModelPicker({
  open,
  onOpenChange,
  isProcessing,
  provider,
  preferredModel,
  availableProviders,
  currentProviderModels,
  currentDefaultModelId,
  modelLabel,
  onSelectModel,
  onSelectProviderModel,
}: ProviderModelPickerProps) {
  const toolbarProviderLabel = provider === "claude" ? "Claude" : getProviderDisplayName(provider);

  return (
    <Menu.Root open={open} onOpenChange={onOpenChange}>
      <Tooltip content="Switch models or providers">
        <Menu.Trigger
          disabled={isProcessing}
          className={`flex shrink-0 items-center gap-1 px-1 text-xs transition-colors ${
            isProcessing ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:text-text"
          } ${preferredModel ? "text-accent" : "text-muted"}`}
        >
          <ProviderLogo provider={provider} className="size-4" />
          <span className="shrink-0 text-text font-semibold">{toolbarProviderLabel}</span>
          <span className="max-w-[10rem] truncate text-text">{modelLabel}</span>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content side="top" align="start" className="min-w-[13rem]">
        {availableProviders.map((option) => {
          const isCurrent = option.provider === provider;
          const optionLabel = option.provider === "claude" ? "Claude" : option.label;
          const models = isCurrent
            ? currentProviderModels
            : (BUILTIN_PROVIDER_MODELS[option.provider] as ProviderModelOption[]);
          const defaultModel = isCurrent
            ? (models.find((model) => model.id === currentDefaultModelId) ??
              models.find((model) => model.isDefault) ??
              models[0])
            : (models.find((model) => model.isDefault) ?? models[0]);

          return (
            <Menu.Sub key={option.provider}>
              <Menu.SubTrigger className="gap-3">
                <ProviderLogo provider={option.provider} className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-sm font-medium">{optionLabel}</span>

                <ChevronRight size={14} strokeWidth={2} className="shrink-0 opacity-50" />
              </Menu.SubTrigger>
              <Menu.SubContent className="min-w-44">
                {isCurrent && (
                  <Menu.Item
                    onClick={() => {
                      onSelectModel(null, defaultModel?.label ?? "Default");
                      onOpenChange(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      Default{defaultModel ? ` (${defaultModel.label})` : ""}
                    </span>
                    {!preferredModel && <Check size={14} strokeWidth={2.5} className="shrink-0" />}
                  </Menu.Item>
                )}
                {models.map((model) => {
                  const isDefault = model.id === defaultModel?.id;
                  // Picker reflects the user's *choice*: "Default" is checked
                  // when no explicit model is selected; per-model items only
                  // check when the user explicitly picked that model. The
                  // toolbar and context panel show the actual running model
                  // (which the "default" tag next to the catalog default
                  // already communicates as "Default resolves to …").
                  const isSelected = isCurrent ? preferredModel === model.id : false;

                  return (
                    <Menu.Item
                      key={model.id}
                      onClick={() => {
                        if (isCurrent) {
                          onSelectModel(model.id, model.label);
                        } else if (onSelectProviderModel) {
                          onSelectProviderModel(option.provider, model.id, model.label);
                        }
                        onOpenChange(false);
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate">{model.label}</span>
                      {isDefault && (
                        <span className="rounded-sm bg-surface-hover px-1 py-px text-[0.625rem] text-muted">
                          default
                        </span>
                      )}
                      {isSelected && <Check size={14} strokeWidth={2.5} className="shrink-0" />}
                    </Menu.Item>
                  );
                })}
              </Menu.SubContent>
            </Menu.Sub>
          );
        })}
      </Menu.Content>
    </Menu.Root>
  );
}

const RUNTIME_MODE_ORDER: ProviderRuntimeMode[] = ["approval-required", "full-access", "plan"];

const RUNTIME_MODE_ICON: Record<ProviderRuntimeMode, typeof LockIcon> = {
  "approval-required": LockIcon,
  "full-access": LockOpenIcon,
  plan: MapIcon,
};

interface RuntimeModePickerProps {
  isProcessing: boolean;
  runtimeMode: ProviderRuntimeMode;
  modes: Partial<Record<ProviderRuntimeMode, ControlOption>>;
  onSetRuntimeMode: (mode: ProviderRuntimeMode) => void;
}

export function RuntimeModePicker({
  isProcessing,
  runtimeMode,
  modes,
  onSetRuntimeMode,
}: RuntimeModePickerProps) {
  const orderedModes = RUNTIME_MODE_ORDER.filter((mode) => modes[mode]);
  const currentOption = modes[runtimeMode];
  const triggerIcon = RUNTIME_MODE_ICON[runtimeMode] ?? LockIcon;
  const TriggerIcon = triggerIcon;
  const label = currentOption?.label ?? runtimeMode;
  const triggerColor =
    runtimeMode === "plan"
      ? "text-warning"
      : runtimeMode === "full-access"
        ? "text-accent"
        : "text-muted";

  return (
    <Menu.Root>
      <Tooltip
        content={
          runtimeMode === "plan"
            ? "Plan mode is active for this chat"
            : "Set runtime mode (permissions / planning)"
        }
      >
        <Menu.Trigger
          disabled={isProcessing}
          className={`flex shrink-0 items-center gap-1 px-1 text-xs transition-colors ${
            isProcessing ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:text-text"
          } ${triggerColor}`}
        >
          <TriggerIcon size={11} strokeWidth={2} />
          <span className="toolbar-control-label">{label}</span>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content side="top" align="start">
        {orderedModes.map((mode) => {
          const option = modes[mode]!;
          const Icon = RUNTIME_MODE_ICON[mode];
          const selected = runtimeMode === mode;
          return (
            <Menu.Item
              key={mode}
              onClick={() => {
                if (!selected) onSetRuntimeMode(mode);
              }}
            >
              <Icon size={13} strokeWidth={2} className="shrink-0" />
              <span className="flex flex-1 flex-col">
                <span>{option.label}</span>
                <span className="text-[0.6875rem] text-muted">{option.description}</span>
              </span>
              {selected && <Check size={13} strokeWidth={2.5} />}
            </Menu.Item>
          );
        })}
      </Menu.Content>
    </Menu.Root>
  );
}

interface ReasoningEffortPickerProps {
  isProcessing: boolean;
  reasoningEffort?: ReasoningEffort;
  levels: { effort: ReasoningEffort; label: string; description: string; isDefault?: boolean }[];
  onSelectEffort: (effort: ReasoningEffort | null) => void;
}

export function ReasoningEffortPicker({
  isProcessing,
  reasoningEffort,
  levels,
  onSelectEffort,
}: ReasoningEffortPickerProps) {
  const activeLevel = levels.find((l) => l.effort === reasoningEffort);
  const defaultLevel = levels.find((l) => l.isDefault);
  const label = activeLevel?.label ?? defaultLevel?.label ?? "Default";

  return (
    <Menu.Root>
      <Tooltip content="Set reasoning effort">
        <Menu.Trigger
          disabled={isProcessing}
          className={`flex shrink-0 items-center gap-1 px-1 text-xs transition-colors ${
            isProcessing ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:text-text"
          } ${reasoningEffort ? "text-accent" : "text-muted"}`}
        >
          <BrainIcon size={11} strokeWidth={2} />
          <span className="toolbar-control-label">{label}</span>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content side="top" align="start">
        <Menu.Item onClick={() => onSelectEffort(null)}>
          <span className="flex flex-1 flex-col">
            <span>Default{defaultLevel ? ` (${defaultLevel.label})` : ""}</span>
            <span className="text-[0.6875rem] text-muted">Uses the model default effort</span>
          </span>
          {!reasoningEffort && <Check size={13} strokeWidth={2.5} />}
        </Menu.Item>
        <Menu.Separator />
        {levels.map((level) => (
          <Menu.Item key={level.effort} onClick={() => onSelectEffort(level.effort)}>
            <span className="flex flex-1 flex-col">
              <span>{level.label}</span>
              <span className="text-[0.6875rem] text-muted">{level.description}</span>
            </span>
            {reasoningEffort === level.effort && <Check size={13} strokeWidth={2.5} />}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
}

interface FastModeToggleProps {
  isProcessing: boolean;
  fastMode?: boolean;
  modes: { off: ControlOption; on: ControlOption };
  onToggle: (enabled: boolean) => void;
}

export function FastModeToggle({ isProcessing, fastMode, modes, onToggle }: FastModeToggleProps) {
  const label = fastMode ? modes.on.label : modes.off.label;

  return (
    <Menu.Root>
      <Tooltip content="Set response speed">
        <Menu.Trigger
          disabled={isProcessing}
          className={`flex shrink-0 items-center gap-1 px-1 text-xs transition-colors ${
            isProcessing ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:text-text"
          } ${fastMode ? "text-accent" : "text-muted"}`}
        >
          <ZapIcon size={11} strokeWidth={2} />
          <span className="toolbar-control-label">{label}</span>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content side="top" align="start">
        <Menu.Item onClick={() => onToggle(false)}>
          <span className="flex flex-1 flex-col">
            <span>{modes.off.label}</span>
            <span className="text-[0.6875rem] text-muted">{modes.off.description}</span>
          </span>
          {!fastMode && <Check size={13} strokeWidth={2.5} />}
        </Menu.Item>
        <Menu.Item onClick={() => onToggle(true)}>
          <span className="flex flex-1 flex-col">
            <span>{modes.on.label}</span>
            <span className="text-[0.6875rem] text-muted">{modes.on.description}</span>
          </span>
          {fastMode && <Check size={13} strokeWidth={2.5} />}
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
