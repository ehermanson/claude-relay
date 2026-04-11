import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { FileText } from "lucide-react";
import {
  fetchProject,
  updateProject,
  fetchProviders,
  fetchProviderModels,
  fetchGlobalSettings,
  fetchHealth,
} from "../lib/api";
import { useProjectContext } from "../context/project-context";
import { Input, Textarea, Select } from "../components/ui/input";
import { RadioGroup, RadioGroupField } from "@/components/ui/radio-group";
import { SettingsSection, SettingRow } from "@/components/settings/settings-shared";
import { ProviderLogo } from "@/components/ui/provider-logo";
import { PageShell } from "@/components/ui/page-shell";
import type { Project, GlobalSettings, ProviderKind } from "@shared/types";

// ─── Hooks ──────────────────────────────────────────────────────────────────

function useProjectAutoSave(project: Project) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Project>) => updateProject(project.id, patch),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ["project", project.id] });
      const previous = queryClient.getQueryData<Project>(["project", project.id]);
      if (previous) {
        queryClient.setQueryData<Project>(["project", project.id], { ...previous, ...patch });
      }
      return { previous };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      toast.success("Settings saved");
    },
    onError: (err, _patch, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["project", project.id], context.previous);
      }
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    },
  });
}

// ─── Settings Page (data loader) ────────────────────────────────────────────

export function SettingsPage() {
  const { artifacts } = useProjectContext();
  const projectId = artifacts.projectId;

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
  });

  const { data: globalSettings, isLoading: isLoadingGlobal } = useQuery({
    queryKey: ["global-settings"],
    queryFn: fetchGlobalSettings,
    staleTime: 60_000,
  });

  if (isLoading || isLoadingGlobal || !project || !globalSettings) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted">Loading settings...</span>
      </div>
    );
  }

  return <SettingsForm key={project.id} project={project} globalSettings={globalSettings} />;
}

// ─── Settings Form ──────────────────────────────────────────────────────────

function SettingsForm({
  project,
  globalSettings,
}: {
  project: Project;
  globalSettings: GlobalSettings;
}) {
  const save = useProjectAutoSave(project);

  return (
    <PageShell maxWidth="narrow">
      <div className="space-y-10">
        <InstructionsSection
          key={`instructions-${project.customInstructions ?? ""}`}
          project={project}
          save={save}
        />
        <RemoteAccessSection />
        <GitSection
          key={`git-${project.defaultSpaceBranch ?? ""}`}
          project={project}
          globalSettings={globalSettings}
          save={save}
        />
        <ProvidersSection project={project} globalSettings={globalSettings} save={save} />
      </div>
    </PageShell>
  );
}

function RemoteAccessSection() {
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    staleTime: 60_000,
  });

  return (
    <SettingsSection
      title="Remote Access"
      description="Connection settings for phones, tablets, and secondary laptops."
    >
      <SettingRow
        label="Open On Phone"
        description={
          health?.authRequired
            ? "Remote access is configured globally because it applies to the whole Relay server."
            : "Relay is running in open mode, and global settings can show a direct QR code for this server."
        }
        vertical
      >
        <div className="space-y-3 text-[0.75rem] text-muted">
          {health?.authRequired ? (
            <div>
              Open{" "}
              <Link to="/settings/general" className="text-accent hover:underline">
                global settings
              </Link>{" "}
              to choose a phone-friendly URL, show a QR code, or generate a one-time pairing code.
            </div>
          ) : (
            <div>
              Open{" "}
              <Link to="/settings/general" className="text-accent hover:underline">
                global settings
              </Link>{" "}
              to choose a LAN or Tailscale address and show a QR code. Add{" "}
              <code className="rounded bg-surface px-1 py-0.5">--password</code> or{" "}
              <code className="rounded bg-surface px-1 py-0.5">RELAY_PASSWORD</code> if you also
              want one-time pairing codes.
            </div>
          )}
        </div>
      </SettingRow>
    </SettingsSection>
  );
}

// ─── Instructions Section ───────────────────────────────────────────────────

function InstructionsSection({
  project,
  save,
}: {
  project: Project;
  save: ReturnType<typeof useProjectAutoSave>;
}) {
  const [value, setValue] = useState(project.customInstructions ?? "");

  const handleBlur = useCallback(() => {
    const trimmed = value.trim() || null;
    if (trimmed !== (project.customInstructions ?? null)) {
      save.mutate({ customInstructions: trimmed });
    }
  }, [save, value, project.customInstructions]);

  return (
    <SettingsSection
      title="Instructions"
      description="Injected into every session for this project. Appended after global instructions."
    >
      <div className="pt-2">
        <Textarea
          rows={8}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
          placeholder="e.g. Always use TypeScript strict mode. Prefer functional components with hooks..."
          className="min-h-[120px] resize-y font-mono text-xs leading-relaxed"
        />
        <div className="mt-2 flex items-center gap-2 text-[0.6875rem] text-muted">
          <FileText size={12} />
          <span>
            You can also add a{" "}
            <code className="rounded bg-surface px-1 py-0.5">.relay/instructions.md</code> file to
            your project root. Both sources are combined.
          </span>
        </div>
      </div>
    </SettingsSection>
  );
}

// ─── Git Section ────────────────────────────────────────────────────────────

function GitSection({
  project,
  globalSettings,
  save,
}: {
  project: Project;
  globalSettings: GlobalSettings;
  save: ReturnType<typeof useProjectAutoSave>;
}) {
  const [branchValue, setBranchValue] = useState(project.defaultSpaceBranch ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Clear pending debounce on unmount
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const cancelPendingDebounce = useCallback(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = undefined;
  }, []);

  const handleBranchChange = useCallback(
    (value: string) => {
      setBranchValue(value);
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

  const globalBranch = globalSettings.defaultSpaceBranch ?? "main";
  const globalBranchSource = globalSettings.spaceBranchSource ?? "local";

  return (
    <SettingsSection title="Git" description="Branch settings for new spaces in this project.">
      <SettingRow
        label="Default Space Branch"
        description="Base branch for new spaces. Falls back to global default if unset."
        overrideInfo={{
          isOverridden:
            project.defaultSpaceBranch != null && project.defaultSpaceBranch !== globalBranch,
          globalLabel: globalBranch,
          onReset: () => {
            cancelPendingDebounce();
            save.mutate({ defaultSpaceBranch: null });
          },
        }}
      >
        <Input
          value={branchValue}
          onChange={(e) => handleBranchChange(e.target.value)}
          placeholder={globalBranch}
          className="w-48"
        />
      </SettingRow>

      <SettingRow
        label="Branch Source"
        description="Whether to branch from local or remote tracking branches."
        overrideInfo={{
          isOverridden:
            project.spaceBranchSource != null && project.spaceBranchSource !== globalBranchSource,
          globalLabel: globalBranchSource === "remote" ? "Remote" : "Local",
          onReset: () => save.mutate({ spaceBranchSource: null }),
        }}
      >
        <RadioGroup
          value={project.spaceBranchSource ?? globalBranchSource}
          onValueChange={handleBranchSourceChange}
          className="flex items-center gap-4"
          name="p-space-branch-source"
        >
          <RadioGroupField value="local" label="Local" />
          <RadioGroupField value="remote" label="Remote" />
        </RadioGroup>
      </SettingRow>
    </SettingsSection>
  );
}

// ─── Providers Section ──────────────────────────────────────────────────────

function ProvidersSection({
  project,
  globalSettings,
  save,
}: {
  project: Project;
  globalSettings: GlobalSettings;
  save: ReturnType<typeof useProjectAutoSave>;
}) {
  const { data: providers = [] } = useQuery({
    queryKey: ["providers"],
    queryFn: fetchProviders,
    staleTime: 60_000,
  });

  // Resolve the effective provider: explicit global > first available provider
  const effectiveGlobalProvider = globalSettings.defaultProvider ?? providers[0]?.provider ?? "";
  const effectiveProvider = project.defaultProvider ?? effectiveGlobalProvider;

  const { data: providerModels } = useQuery({
    queryKey: ["provider-models", effectiveProvider],
    queryFn: () => fetchProviderModels(effectiveProvider as ProviderKind),
    enabled: !!effectiveProvider,
    staleTime: 60_000,
  });
  const models = providerModels?.models ?? [];

  // Resolve effective labels for the override indicator
  const globalProviderLabel =
    providers.find((p) => p.provider === effectiveGlobalProvider)?.label ??
    providers[0]?.label ??
    "System default";

  // Resolve the effective inherited model using the same priority as the backend:
  // project.defaultModel > providerDefaults[provider].model > provider's built-in default
  // Key: use effectiveProvider (which accounts for project-level provider override),
  // not effectiveGlobalProvider, since models are provider-specific.
  const providerDefaults = globalSettings.providerDefaults ?? {};
  const perProviderModel = providerDefaults[effectiveProvider]?.model ?? null;
  const builtInDefault = models.find((m) => m.isDefault);

  const effectiveGlobalModelId = perProviderModel ?? builtInDefault?.id ?? null;
  const effectiveGlobalModelLabel = (() => {
    if (perProviderModel) {
      const m = models.find((mod) => mod.id === perProviderModel);
      return m?.label ?? perProviderModel;
    }
    return builtInDefault?.label ?? "Provider default";
  })();

  const handleProviderChange = (value: string) => {
    // When changing provider, also clear model since it may not be valid
    save.mutate({ defaultProvider: value || null, defaultModel: null });
  };

  const handleModelChange = (value: string) => {
    save.mutate({ defaultModel: value || null });
  };

  return (
    <SettingsSection
      title="Providers"
      description="Default provider and model for sessions in this project."
    >
      {/* Default provider — only useful if there are multiple */}
      {providers.length > 1 && (
        <SettingRow
          label="Default Provider"
          description="Preferred provider for new sessions in this project."
          overrideInfo={{
            isOverridden:
              project.defaultProvider != null &&
              project.defaultProvider !== effectiveGlobalProvider,
            globalLabel: globalProviderLabel,
            onReset: () => save.mutate({ defaultProvider: null, defaultModel: null }),
          }}
        >
          <Select
            inputSize="md"
            value={project.defaultProvider ?? ""}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="w-44"
          >
            <option value="">Inherit global ({globalProviderLabel})</option>
            {providers.map((p) => (
              <option key={p.provider} value={p.provider}>
                {p.label}
              </option>
            ))}
          </Select>
        </SettingRow>
      )}

      {/* Default model */}
      <SettingRow
        label="Default Model"
        description="Preferred model for new sessions. Can be overridden per session."
        overrideInfo={{
          isOverridden:
            project.defaultModel != null && project.defaultModel !== effectiveGlobalModelId,
          globalLabel: effectiveGlobalModelLabel,
          onReset: () => save.mutate({ defaultModel: null }),
        }}
      >
        <Select
          inputSize="md"
          value={project.defaultModel ?? ""}
          onChange={(e) => handleModelChange(e.target.value)}
          disabled={!effectiveProvider}
          className="w-52"
        >
          <option value="">Inherit global ({effectiveGlobalModelLabel})</option>
          {models
            .filter((m) => !m.hidden)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
        </Select>
      </SettingRow>

      {/* Per-provider defaults display (read-only summary) */}
      {providers.length > 0 && (
        <PerProviderSummary providers={providers} globalSettings={globalSettings} />
      )}
    </SettingsSection>
  );
}

// ─── Per-Provider Summary (shows global defaults, directs to global settings) ─

function PerProviderSummary({
  providers,
  globalSettings,
}: {
  providers: { provider: ProviderKind; label: string }[];
  globalSettings: GlobalSettings;
}) {
  const providerDefaults = globalSettings.providerDefaults ?? {};
  const hasAnyDefaults = Object.keys(providerDefaults).some((key) => {
    const d = providerDefaults[key];
    return (
      d &&
      (d.model ||
        d.reasoningEffort ||
        d.reasoningBudget != null ||
        d.runtimeMode ||
        d.fastMode != null)
    );
  });

  if (!hasAnyDefaults) return null;

  return (
    <div className="py-5">
      <div className="text-[0.8125rem] font-medium text-text-bright">Per-Provider Defaults</div>
      <div className="mt-0.5 text-[0.75rem] text-muted">
        These are set globally and apply to all projects.{" "}
        <Link to="/settings/providers" className="text-accent hover:underline">
          Edit in global settings
        </Link>
      </div>
      <div className="mt-3 space-y-2 pl-1">
        {providers.map((p) => {
          const d = providerDefaults[p.provider];
          if (!d) return null;
          const parts: string[] = [];
          if (d.model) parts.push(`Model: ${d.model}`);
          if (d.reasoningEffort) parts.push(`Reasoning: ${d.reasoningEffort}`);
          if (d.reasoningBudget != null) parts.push(`Reasoning budget: ${d.reasoningBudget}`);
          if (d.runtimeMode) parts.push(`Permissions: ${d.runtimeMode}`);
          if (d.fastMode != null) parts.push(`Fast mode: ${d.fastMode ? "on" : "off"}`);
          if (parts.length === 0) return null;
          return (
            <div key={p.provider} className="flex items-start gap-2 text-[0.75rem]">
              <ProviderLogo provider={p.provider} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <span className="font-medium text-text">{p.label}</span>
                <span className="text-muted"> — {parts.join(", ")}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
