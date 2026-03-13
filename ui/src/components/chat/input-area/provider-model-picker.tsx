import {
  BrainIcon,
  Check,
  ChevronRight,
  HammerIcon,
  LockIcon,
  LockOpenIcon,
  MapIcon,
} from "lucide-react";
import type { ProviderKind, ProviderModelOption } from "@shared/types";
import { BUILTIN_PROVIDER_MODELS, getProviderDisplayName } from "@shared/provider-catalog";
import { Menu } from "../../ui/menu";
import { Tooltip } from "../../ui/tooltip";
import { ProviderLogo, REASONING_LEVELS, SESSION_PROVIDER_OPTIONS } from "./shared";

interface ProviderModelPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isProcessing: boolean;
  provider: ProviderKind;
  preferredModel?: string;
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
        {SESSION_PROVIDER_OPTIONS.map((option) => {
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
  reasoningLabel: string;
  onSelectReasoningBudget: (budget: number | null) => void;
}

export function ReasoningPicker({
  isProcessing,
  reasoningBudget,
  reasoningLabel,
  onSelectReasoningBudget,
}: ReasoningPickerProps) {
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
          <span>{reasoningLabel}</span>
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
        {REASONING_LEVELS.map((level) => (
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
  provider: ProviderKind;
  isProcessing: boolean;
  skipPermissions?: boolean;
  onToggle: () => void;
}

export function PermissionsToggle({
  provider,
  isProcessing,
  skipPermissions,
  onToggle,
}: PermissionsToggleProps) {
  return (
    <Tooltip
      content={
        provider === "codex"
          ? skipPermissions
            ? "Full access — click to use the workspace sandbox"
            : "Workspace sandbox — click for full access"
          : skipPermissions
            ? "Full access — click to ask permission"
            : "Ask permission — click for full access"
      }
    >
      <button
        onClick={onToggle}
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
        <span>
          {provider === "codex"
            ? skipPermissions
              ? "Full access"
              : "Sandboxed"
            : skipPermissions
              ? "Full access"
              : "Ask Permission"}
        </span>
      </button>
    </Tooltip>
  );
}

interface PlanModePickerProps {
  isProcessing: boolean;
  planMode?: boolean;
  onTogglePlanMode: (planMode: boolean) => void;
}

export function PlanModePicker({ isProcessing, planMode, onTogglePlanMode }: PlanModePickerProps) {
  const label = planMode ? "Plan" : "Build";

  return (
    <Menu.Root>
      <Tooltip
        content={
          planMode
            ? "Plan mode is active for this session"
            : "Switch between build and planning mode"
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
          <span>{label}</span>
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content side="top" align="start">
        <Menu.Item onClick={() => onTogglePlanMode(false)}>
          <HammerIcon size={13} strokeWidth={2} className="shrink-0" />
          <span className="flex flex-1 flex-col">
            <span>Build</span>
            <span className="text-[0.6875rem] text-muted">Standard working mode</span>
          </span>
          {!planMode && <Check size={13} strokeWidth={2.5} />}
        </Menu.Item>
        <Menu.Item onClick={() => onTogglePlanMode(true)}>
          <MapIcon size={13} strokeWidth={2} className="shrink-0" />
          <span className="flex flex-1 flex-col">
            <span>Plan</span>
            <span className="text-[0.6875rem] text-muted">
              Stay in planning mode for this session
            </span>
          </span>
          {planMode && <Check size={13} strokeWidth={2.5} />}
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
