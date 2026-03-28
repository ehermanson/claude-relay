import {
  BrainIcon,
  Check,
  ChevronRight,
  GaugeIcon,
  HammerIcon,
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
  modelLabel: string;
  onSelectModel: (model: string | null) => void;
  /** Called when user selects a model from a different provider's panel */
  onSelectProviderModel?: (provider: ProviderKind, model: string | null) => void;
}

export function ProviderModelPicker({
  open,
  onOpenChange,
  isProcessing,
  provider,
  preferredModel,
  availableProviders,
  currentProviderModels,
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
          const defaultModel = models.find((m) => m.isDefault) ?? models[0];

          return (
            <Menu.Sub key={option.provider}>
              <Menu.SubTrigger className="gap-3">
                <ProviderLogo provider={option.provider} className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-sm font-medium">{optionLabel}</span>

                <ChevronRight size={14} strokeWidth={2} className="shrink-0 opacity-50" />
              </Menu.SubTrigger>
              <Menu.SubContent className="min-w-44">
                {models.map((model) => {
                  const isDefault = model.id === defaultModel?.id;
                  const isSelected = isCurrent
                    ? preferredModel === model.id || (!preferredModel && isDefault)
                    : false;

                  return (
                    <Menu.Item
                      key={model.id}
                      onClick={() => {
                        if (isCurrent) {
                          onSelectModel(isDefault ? null : model.id);
                        } else if (onSelectProviderModel) {
                          onSelectProviderModel(option.provider, isDefault ? null : model.id);
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

interface ReasoningPickerProps {
  isProcessing: boolean;
  reasoningBudget?: number;
  levels: { budget: number; label: string; description: string }[];
  onSelectReasoningBudget: (budget: number | null) => void;
}

export function ReasoningPicker({
  isProcessing,
  reasoningBudget,
  levels,
  onSelectReasoningBudget,
}: ReasoningPickerProps) {
  const activeLevel = levels.find((l) => l.budget === reasoningBudget);
  const label = activeLevel?.label ?? (reasoningBudget ? "Custom" : "Default");

  return (
    <Menu.Root>
      <Tooltip content="Set reasoning effort">
        <Menu.Trigger
          disabled={isProcessing}
          className={`flex shrink-0 items-center gap-1 px-1 text-xs transition-colors ${
            isProcessing ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:text-text"
          } ${reasoningBudget != null ? "text-accent" : "text-muted"}`}
        >
          <BrainIcon size={11} strokeWidth={2} />
          <span className="toolbar-control-label">{label}</span>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content side="top" align="start">
        <Menu.Item onClick={() => onSelectReasoningBudget(null)}>
          <span className="flex flex-1 flex-col">
            <span>Default</span>
            <span className="text-[0.6875rem] text-muted">Uses the model default effort</span>
          </span>
          {reasoningBudget == null && <Check size={13} strokeWidth={2.5} />}
        </Menu.Item>
        <Menu.Separator />
        {levels.map((level) => (
          <Menu.Item key={level.budget} onClick={() => onSelectReasoningBudget(level.budget)}>
            <span className="flex flex-1 flex-col">
              <span>{level.label}</span>
              <span className="text-[0.6875rem] text-muted">{level.description}</span>
            </span>
            {reasoningBudget === level.budget && <Check size={13} strokeWidth={2.5} />}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
}

interface PermissionsToggleProps {
  isProcessing: boolean;
  skipPermissions?: boolean;
  modes: { restricted: ControlOption; fullAccess: ControlOption };
  onToggle: () => void;
}

export function PermissionsToggle({
  isProcessing,
  skipPermissions,
  modes,
  onToggle,
}: PermissionsToggleProps) {
  const label = skipPermissions ? modes.fullAccess.label : modes.restricted.label;

  return (
    <Menu.Root>
      <Tooltip content="Set permission mode">
        <Menu.Trigger
          disabled={isProcessing}
          className={`flex shrink-0 items-center gap-1 px-1 text-xs transition-colors ${
            isProcessing ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:text-text"
          } ${skipPermissions ? "text-accent" : "text-muted"}`}
        >
          {skipPermissions ? (
            <LockOpenIcon size={11} strokeWidth={2} />
          ) : (
            <LockIcon size={11} strokeWidth={2} />
          )}
          <span className="toolbar-control-label">{label}</span>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content side="top" align="start">
        <Menu.Item
          onClick={() => {
            if (skipPermissions) onToggle();
          }}
        >
          <LockIcon size={13} strokeWidth={2} className="shrink-0" />
          <span className="flex flex-1 flex-col">
            <span>{modes.restricted.label}</span>
            <span className="text-[0.6875rem] text-muted">{modes.restricted.description}</span>
          </span>
          {!skipPermissions && <Check size={13} strokeWidth={2.5} />}
        </Menu.Item>
        <Menu.Item
          onClick={() => {
            if (!skipPermissions) onToggle();
          }}
        >
          <LockOpenIcon size={13} strokeWidth={2} className="shrink-0" />
          <span className="flex flex-1 flex-col">
            <span>{modes.fullAccess.label}</span>
            <span className="text-[0.6875rem] text-muted">{modes.fullAccess.description}</span>
          </span>
          {skipPermissions && <Check size={13} strokeWidth={2.5} />}
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

interface ReasoningEffortPickerProps {
  isProcessing: boolean;
  reasoningEffort?: ReasoningEffort;
  levels: { effort: ReasoningEffort; label: string; description: string }[];
  onSelectEffort: (effort: ReasoningEffort | null) => void;
}

export function ReasoningEffortPicker({
  isProcessing,
  reasoningEffort,
  levels,
  onSelectEffort,
}: ReasoningEffortPickerProps) {
  const activeLevel = levels.find((l) => l.effort === reasoningEffort);
  const label = activeLevel?.label ?? "Default";

  return (
    <Menu.Root>
      <Tooltip content="Set reasoning effort">
        <Menu.Trigger
          disabled={isProcessing}
          className={`flex shrink-0 items-center gap-1 px-1 text-xs transition-colors ${
            isProcessing ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:text-text"
          } ${reasoningEffort ? "text-accent" : "text-muted"}`}
        >
          <GaugeIcon size={11} strokeWidth={2} />
          <span className="toolbar-control-label">{label}</span>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content side="top" align="start">
        <Menu.Item onClick={() => onSelectEffort(null)}>
          <span className="flex flex-1 flex-col">
            <span>Default</span>
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

interface PlanModePickerProps {
  isProcessing: boolean;
  planMode?: boolean;
  modes: { off: ControlOption; on: ControlOption };
  onTogglePlanMode: (planMode: boolean) => void;
}

export function PlanModePicker({
  isProcessing,
  planMode,
  modes,
  onTogglePlanMode,
}: PlanModePickerProps) {
  const label = planMode ? modes.on.label : modes.off.label;

  return (
    <Menu.Root>
      <Tooltip
        content={
          planMode ? "Plan mode is active for this chat" : "Switch between build and planning mode"
        }
      >
        <Menu.Trigger
          disabled={isProcessing}
          className={`flex shrink-0 items-center gap-1 px-1 text-xs transition-colors ${
            isProcessing ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:text-text"
          } ${planMode ? "text-warning" : "text-muted"}`}
        >
          {planMode ? (
            <MapIcon size={11} strokeWidth={2} />
          ) : (
            <HammerIcon size={11} strokeWidth={2} />
          )}
          <span className="toolbar-control-label">{label}</span>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content side="top" align="start">
        <Menu.Item onClick={() => onTogglePlanMode(false)}>
          <HammerIcon size={13} strokeWidth={2} className="shrink-0" />
          <span className="flex flex-1 flex-col">
            <span>{modes.off.label}</span>
            <span className="text-[0.6875rem] text-muted">{modes.off.description}</span>
          </span>
          {!planMode && <Check size={13} strokeWidth={2.5} />}
        </Menu.Item>
        <Menu.Item onClick={() => onTogglePlanMode(true)}>
          <MapIcon size={13} strokeWidth={2} className="shrink-0" />
          <span className="flex flex-1 flex-col">
            <span>{modes.on.label}</span>
            <span className="text-[0.6875rem] text-muted">{modes.on.description}</span>
          </span>
          {planMode && <Check size={13} strokeWidth={2.5} />}
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
