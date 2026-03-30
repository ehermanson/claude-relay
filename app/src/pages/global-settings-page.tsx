import { useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sun, Moon, Monitor } from "lucide-react";
import {
  fetchGlobalSettings,
  updateGlobalSettings,
  fetchProviders,
  fetchProviderModels,
} from "../lib/api";
import { Input, Textarea, Select } from "../components/ui/input";
import { RadioGroup, RadioGroupField } from "@/components/ui/radio-group";
import { ProviderLogo } from "@/components/ui/provider-logo";
import { SettingsSection, SettingRow } from "@/components/settings/settings-shared";
import { useThemeStore, type ThemePreference } from "@/stores/theme-store";
import type { GlobalSettings, ProviderDefaults, ProviderDescriptor } from "@shared/types";

// ─── Defaults & hooks ──────────────────────────────────────────────────────

const DEFAULT_SETTINGS: GlobalSettings = {
  theme: "dark",
  defaultOpenTarget: null,
  defaultProvider: null,
  defaultModel: null,
  defaultSpaceBranch: null,
  spaceBranchSource: "local",
  providerDefaults: {},
  customInstructions: null,
};

export function useGlobalSettings() {
  return useQuery({
    queryKey: ["global-settings"],
    queryFn: fetchGlobalSettings,
    staleTime: 60_000,
    placeholderData: DEFAULT_SETTINGS,
  });
}

function useAutoSave() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (patch: Partial<GlobalSettings>) => updateGlobalSettings(patch),
    onMutate: async (patch) => {
      // Cancel outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ["global-settings"] });
      const previous = queryClient.getQueryData<GlobalSettings>(["global-settings"]);
      // Optimistically merge the patch into cached settings
      if (previous) {
        queryClient.setQueryData<GlobalSettings>(["global-settings"], {
          ...previous,
          ...patch,
          // Deep-merge providerDefaults if present
          providerDefaults: patch.providerDefaults
            ? { ...previous.providerDefaults, ...patch.providerDefaults }
            : previous.providerDefaults,
        });
      }
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["global-settings"] });
      toast.success("Settings saved");
    },
    onError: (err, _patch, context) => {
      // Roll back to previous value on failure
      if (context?.previous) {
        queryClient.setQueryData(["global-settings"], context.previous);
      }
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    },
  });
  return mutation;
}

// ─── General Section ───────────────────────────────────────────────────────

export function GeneralSettingsSection() {
  const themeStore = useThemeStore();
  const save = useAutoSave();

  const handleThemeChange = (newTheme: ThemePreference) => {
    themeStore.setTheme(newTheme);
    save.mutate({ theme: newTheme });
  };

  return (
    <SettingsSection title="General" description="Manage appearance and default behaviors.">
      <SettingRow label="Theme" description="Choose between light, dark, or system appearance.">
        <ThemeToggle value={themeStore.preference} onChange={handleThemeChange} />
      </SettingRow>
    </SettingsSection>
  );
}

// ─── Theme toggle (segmented) ──────────────────────────────────────────────

function ThemeToggle({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (v: ThemePreference) => void;
}) {
  const options = [
    { value: "light" as const, icon: Sun, label: "Light" },
    { value: "dark" as const, icon: Moon, label: "Dark" },
    { value: "system" as const, icon: Monitor, label: "System" },
  ];

  return (
    <div className="flex rounded-lg border border-border bg-surface/60 p-0.5">
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[0.75rem] font-medium transition-colors ${
              active ? "bg-surface-hover text-text-bright shadow-sm" : "text-muted hover:text-text"
            }`}
          >
            <Icon size={13} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Providers Section ─────────────────────────────────────────────────────

export function ProvidersSettingsSection() {
  const { data: settings } = useGlobalSettings();
  const save = useAutoSave();

  const { data: providers = [] } = useQuery({
    queryKey: ["providers"],
    queryFn: fetchProviders,
    staleTime: 60_000,
  });

  const defaultProvider = settings?.defaultProvider ?? "";
  const providerDefaults = settings?.providerDefaults ?? {};

  const handleProviderChange = (provider: string) => {
    save.mutate({ defaultProvider: provider || null });
  };

  const handleProviderDefaultChange = (
    provider: string,
    field: keyof ProviderDefaults,
    value: string,
  ) => {
    let parsed: string | number | boolean | undefined = value || undefined;
    if (field === "reasoningBudget" && value) {
      parsed = Number(value);
    } else if (field === "fastMode" && value) {
      parsed = value === "true";
    }
    const updated = {
      ...providerDefaults,
      [provider]: { ...providerDefaults[provider], [field]: parsed },
    };
    save.mutate({ providerDefaults: updated });
  };

  return (
    <SettingsSection
      title="Providers"
      description="Default provider, model, and per-provider settings."
    >
      {/* Default Provider — only show if multiple providers */}
      {providers.length > 1 && (
        <SettingRow label="Default Provider" description="The default provider for new sessions.">
          <Select
            inputSize="md"
            value={defaultProvider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="w-44"
          >
            {providers.map((p) => (
              <option key={p.provider} value={p.provider}>
                {p.label}
              </option>
            ))}
          </Select>
        </SettingRow>
      )}

      {/* Per-provider defaults — always expanded */}
      {providers.map((p) => (
        <ProviderDefaultsRow
          key={p.provider}
          provider={p}
          defaults={providerDefaults[p.provider] ?? {}}
          onChange={(field, value) => handleProviderDefaultChange(p.provider, field, value)}
        />
      ))}
    </SettingsSection>
  );
}

// ─── Provider Defaults Row (always visible, no expand) ─────────────────────

function ProviderDefaultsRow({
  provider,
  defaults,
  onChange,
}: {
  provider: ProviderDescriptor;
  defaults: ProviderDefaults;
  onChange: (field: keyof ProviderDefaults, value: string) => void;
}) {
  const { data: providerModels } = useQuery({
    queryKey: ["provider-models", provider.provider],
    queryFn: () => fetchProviderModels(provider.provider),
    staleTime: 60_000,
  });
  const models = providerModels?.models ?? [];
  const caps = providerModels?.capabilities ?? provider.capabilities;

  // Find actual defaults to show in placeholder text
  const defaultModel = models.find((m) => m.isDefault);
  const defaultPermLabel = caps.permissionModes?.restricted.label; // restricted is always the default

  const hasAnyControls =
    caps.supportsModelSelection ||
    (caps.supportsReasoningEffort && caps.reasoningEffortLevels) ||
    (caps.supportsReasoningBudget && caps.reasoningBudgetLevels) ||
    caps.permissionModes ||
    (caps.supportsFastMode && caps.fastModes);

  if (!hasAnyControls) return null;

  return (
    <div className="py-5">
      <div className="flex items-center gap-2.5 mb-4">
        <ProviderLogo provider={provider.provider} className="h-4 w-4" />
        <div>
          <div className="text-[0.8125rem] font-medium text-text-bright">
            {provider.label} Defaults
          </div>
          <div className="mt-0.5 text-[0.75rem] text-muted">
            Saved defaults when using {provider.label}.
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 pl-7">
        {caps.supportsModelSelection && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.6875rem] font-medium text-muted">Model</label>
            <Select
              inputSize="md"
              value={defaults.model ?? ""}
              onChange={(e) => onChange("model", e.target.value)}
            >
              <option value="">
                {defaultModel ? `${defaultModel.label} (default)` : "Provider default"}
              </option>
              {models
                .filter((m) => !m.hidden)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
            </Select>
          </div>
        )}
        {caps.supportsReasoningEffort && caps.reasoningEffortLevels && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.6875rem] font-medium text-muted">Reasoning</label>
            <Select
              inputSize="md"
              value={defaults.reasoningEffort ?? ""}
              onChange={(e) => onChange("reasoningEffort", e.target.value)}
            >
              <option value="">Medium (default)</option>
              {caps.reasoningEffortLevels.map((level) => (
                <option key={level.effort} value={level.effort}>
                  {level.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        {caps.supportsReasoningBudget && caps.reasoningBudgetLevels && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.6875rem] font-medium text-muted">Reasoning</label>
            <Select
              inputSize="md"
              value={defaults.reasoningBudget != null ? String(defaults.reasoningBudget) : ""}
              onChange={(e) => onChange("reasoningBudget", e.target.value)}
            >
              <option value="">Medium (default)</option>
              {caps.reasoningBudgetLevels.map((level) => (
                <option key={level.budget} value={String(level.budget)}>
                  {level.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        {caps.permissionModes && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.6875rem] font-medium text-muted">Permissions</label>
            <Select
              inputSize="md"
              value={defaults.runtimeMode ?? ""}
              onChange={(e) => onChange("runtimeMode", e.target.value)}
            >
              <option value="">
                {defaultPermLabel ? `${defaultPermLabel} (default)` : "Default"}
              </option>
              <option value="approval-required">{caps.permissionModes.restricted.label}</option>
              <option value="full-access">{caps.permissionModes.fullAccess.label}</option>
            </Select>
          </div>
        )}
        {caps.supportsFastMode && caps.fastModes && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[0.6875rem] font-medium text-muted">Speed</label>
            <Select
              inputSize="md"
              value={defaults.fastMode != null ? String(defaults.fastMode) : ""}
              onChange={(e) => onChange("fastMode", e.target.value)}
            >
              <option value="">{caps.fastModes.off.label} (default)</option>
              <option value="true">{caps.fastModes.on.label}</option>
              <option value="false">{caps.fastModes.off.label}</option>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Git Section ───────────────────────────────────────────────────────────

export function GitSettingsSection() {
  const { data: settings } = useGlobalSettings();
  const save = useAutoSave();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleBranchChange = useCallback(
    (value: string) => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        save.mutate({ defaultSpaceBranch: value.trim() || null });
      }, 600);
    },
    [save],
  );

  const handleBranchSourceChange = (value: string) => {
    save.mutate({ spaceBranchSource: value as "local" | "remote" });
  };

  return (
    <SettingsSection
      title="Git"
      description="Default branch settings for new spaces. Projects can override these."
    >
      <SettingRow
        label="Default Space Branch"
        description="Base branch for new spaces when a project doesn't specify one."
      >
        <Input
          defaultValue={settings?.defaultSpaceBranch ?? ""}
          onChange={(e) => handleBranchChange(e.target.value)}
          placeholder="e.g. main"
          className="w-48"
        />
      </SettingRow>

      <SettingRow
        label="Branch Source"
        description="Whether to branch from local or remote tracking branches."
      >
        <RadioGroup
          value={settings?.spaceBranchSource ?? "local"}
          onValueChange={handleBranchSourceChange}
          className="flex items-center gap-4"
          name="g-space-branch-source"
        >
          <RadioGroupField value="local" label="Local" />
          <RadioGroupField value="remote" label="Remote" />
        </RadioGroup>
      </SettingRow>
    </SettingsSection>
  );
}

// ─── Instructions Section ──────────────────────────────────────────────────

export function InstructionsSettingsSection() {
  const { data: settings } = useGlobalSettings();
  const save = useAutoSave();

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLTextAreaElement>) => {
      const value = e.target.value.trim() || null;
      if (value !== (settings?.customInstructions ?? null)) {
        save.mutate({ customInstructions: value });
      }
    },
    [save, settings?.customInstructions],
  );

  return (
    <SettingsSection
      title="Global Instructions"
      description="Injected into every session across all projects. Project-level instructions are appended after these."
    >
      <div className="pt-2">
        <Textarea
          rows={10}
          defaultValue={settings?.customInstructions ?? ""}
          onBlur={handleBlur}
          placeholder="e.g. Always respond concisely. Use American English spelling..."
          className="min-h-[160px] resize-y font-mono text-xs leading-relaxed"
        />
      </div>
    </SettingsSection>
  );
}
