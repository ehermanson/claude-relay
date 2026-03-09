import { BrainIcon, Check, ChevronDown, ChevronRight, LockIcon, LockOpenIcon } from "lucide-react";
import type { ProviderKind, ProviderModelOption } from "@shared/types";
import { getProviderDisplayName } from "@shared/provider-catalog";
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
  defaultMenuLabel: string;
  modelLabel: string;
  onSelectModel: (model: string | null) => void;
  onStartProviderSwitch?: (provider: ProviderKind) => void;
}

export function ProviderModelPicker({
  open,
  onOpenChange,
  isProcessing,
  provider,
  preferredModel,
  currentProviderModels,
  defaultMenuLabel,
  modelLabel,
  onSelectModel,
  onStartProviderSwitch,
}: ProviderModelPickerProps) {
  const providerLabel = getProviderDisplayName(provider);
  const toolbarProviderLabel = provider === "claude" ? "Claude" : providerLabel;

  return (
    <Menu.Root open={open} onOpenChange={onOpenChange}>
      <Tooltip content="Switch models here, or start a new chat to change providers">
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
      <Menu.Content side="top" align="start" className="w-[min(92vw,40rem)] p-0">
        <div className="grid min-w-0 overflow-hidden md:grid-cols-[15rem_minmax(0,1fr)]">
          <div className="border-b border-border bg-surface/60 p-2 md:border-r md:border-b-0">
            <div className="px-2 pb-2 text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-muted">
              Provider
            </div>
            <div className="space-y-1">
              {SESSION_PROVIDER_OPTIONS.map((option) => {
                const isCurrent = option.provider === provider;
                const canSwitch = !isCurrent && !!onStartProviderSwitch && !isProcessing;
                const optionLabel = option.provider === "claude" ? "Claude" : option.label;

                return (
                  <button
                    key={option.provider}
                    type="button"
                    onClick={() => {
                      if (canSwitch) onStartProviderSwitch(option.provider);
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
                        <div className="truncate text-sm font-medium">{optionLabel}</div>
                        <div className="text-[0.6875rem] text-muted">
                          {isCurrent
                            ? "Active provider for this chat"
                            : `Start a new ${optionLabel} chat`}
                        </div>
                      </div>
                    </div>
                    {isCurrent ? (
                      <Check size={14} strokeWidth={2.5} className="shrink-0" />
                    ) : (
                      <ChevronRight
                        size={14}
                        strokeWidth={2.5}
                        className={canSwitch ? "shrink-0 opacity-70" : "shrink-0 opacity-30"}
                      />
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
                  onSelectModel(null);
                  onOpenChange(false);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-1 text-left text-sm text-text transition-colors hover:bg-surface-hover"
              >
                <div className="min-w-0 flex-1 truncate">{defaultMenuLabel}</div>
                {!preferredModel && <Check size={14} strokeWidth={2.5} className="shrink-0" />}
              </button>

              {currentProviderModels.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    onSelectModel(model.id);
                    onOpenChange(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-1 text-left text-sm text-text transition-colors hover:bg-surface-hover"
                >
                  <div className="min-w-0 flex-1 truncate">{model.label}</div>
                  {preferredModel === model.id && (
                    <Check size={14} strokeWidth={2.5} className="shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
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
            ? "Full access — click to require approvals"
            : "Limited — click for full access"
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
              : "Limited"}
        </span>
      </button>
    </Tooltip>
  );
}
