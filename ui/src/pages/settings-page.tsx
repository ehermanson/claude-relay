import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, FileText, Info } from "lucide-react";
import {
  fetchProject,
  updateProject,
  fetchProviders,
  fetchProviderModels,
  fetchGlobalSettings,
} from "../lib/api";
import { useProjectContext } from "../context/project-context";
import { Input, Textarea, Select } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { RadioGroup, RadioGroupField } from "@/components/ui/radio-group";
import type { GlobalSettings, Project, ProviderKind } from "@shared/types";
import { PageShell } from "@/components/ui/page-shell";

// ─── Settings Page (data loader) ────────────────────────────────────────────

export function SettingsPage() {
  const { artifacts } = useProjectContext();
  const projectId = artifacts.projectId;

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
  });

  if (isLoading || !project) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted">Loading settings...</span>
      </div>
    );
  }

  return <SettingsForm key={project.id} project={project} />;
}

// ─── Settings Form ──────────────────────────────────────────────────────────

function SettingsForm({ project }: { project: Project }) {
  const queryClient = useQueryClient();

  const { data: providers = [] } = useQuery({
    queryKey: ["providers"],
    queryFn: fetchProviders,
  });

  const { data: globalSettings } = useQuery({
    queryKey: ["globalSettings"],
    queryFn: fetchGlobalSettings,
  });

  // Form state — initialized directly from project props (no useEffect sync)
  const [customInstructions, setCustomInstructions] = useState(project.customInstructions ?? "");
  const [defaultSpaceBranch, setDefaultSpaceBranch] = useState(project.defaultSpaceBranch ?? "");
  const [spaceBranchSource, setSpaceBranchSource] = useState<"local" | "remote">(
    project.spaceBranchSource ?? "local",
  );
  const [defaultProvider, setDefaultProvider] = useState(project.defaultProvider ?? "");
  const [defaultModel, setDefaultModel] = useState(project.defaultModel ?? "");

  // Fetch models for selected provider
  const { data: providerModels } = useQuery({
    queryKey: ["provider-models", defaultProvider],
    queryFn: () => fetchProviderModels(defaultProvider as ProviderKind),
    enabled: !!defaultProvider,
  });
  const models = providerModels?.models ?? [];

  // Track if form has changes
  const hasChanges =
    customInstructions !== (project.customInstructions ?? "") ||
    defaultSpaceBranch !== (project.defaultSpaceBranch ?? "") ||
    spaceBranchSource !== (project.spaceBranchSource ?? "local") ||
    defaultProvider !== (project.defaultProvider ?? "") ||
    defaultModel !== (project.defaultModel ?? "");

  const saveMutation = useMutation({
    mutationFn: () =>
      updateProject(project.id, {
        customInstructions: customInstructions.trim() || null,
        defaultSpaceBranch: defaultSpaceBranch.trim() || null,
        spaceBranchSource,
        defaultProvider: defaultProvider || null,
        defaultModel: defaultModel || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", project.id] });
      toast.success("Settings saved");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    },
  });

  const handleSave = useCallback(() => {
    saveMutation.mutate();
  }, [saveMutation]);

  return (
    <PageShell maxWidth="narrow">
      <div className="space-y-8">
        {/* Custom Instructions */}
        <section className="space-y-3">
          <div>
            <label htmlFor="custom-instructions" className="text-sm font-semibold text-text-bright">
              Custom Instructions
            </label>
            <p className="mt-0.5 text-[0.75rem] text-muted">
              Instructions injected into every new session for this project. These guide the model's
              behavior — add coding standards, architecture notes, or style conventions.
            </p>
          </div>
          <Textarea
            id="custom-instructions"
            rows={8}
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            placeholder="e.g. Always use TypeScript strict mode. Prefer functional components with hooks..."
            className="min-h-[120px] resize-y font-mono text-xs leading-relaxed"
          />
          <div className="flex items-center gap-2 text-[0.6875rem] text-muted">
            <FileText size={12} />
            <span>
              You can also add a{" "}
              <code className="rounded bg-surface px-1 py-0.5">.relay/instructions.md</code> file to
              your project root. Both sources are combined.
            </span>
          </div>
        </section>

        {/* Default Space Branch */}
        <section className="space-y-3">
          <div>
            <label
              htmlFor="default-space-branch"
              className="text-sm font-semibold text-text-bright"
            >
              Default Space Branch
            </label>
            <p className="mt-0.5 text-[0.75rem] text-muted">
              The base branch for new spaces. If empty, the repository's default branch is used
              (typically <code className="rounded bg-surface px-1 py-0.5">main</code>).
            </p>
          </div>
          <Input
            id="default-space-branch"
            value={defaultSpaceBranch}
            onChange={(e) => setDefaultSpaceBranch(e.target.value)}
            placeholder="e.g. main"
          />
          <fieldset className="mt-2">
            <legend className="text-[0.6875rem] font-medium text-muted">Branch from</legend>
            <RadioGroup
              value={spaceBranchSource}
              onValueChange={(value) => setSpaceBranchSource(value as "local" | "remote")}
              className="mt-1.5 flex items-center gap-4"
              name="space-branch-source"
            >
              <RadioGroupField value="local" label="Local branch" />
              <RadioGroupField value="remote" label="Remote tracking branch" />
            </RadioGroup>
          </fieldset>
        </section>

        {/* Default Provider & Model */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-text-bright">Default Provider & Model</h2>
            <p className="mt-0.5 text-[0.75rem] text-muted">
              Preferred provider and model for new sessions in this project. Can be overridden per
              session.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="default-provider" className="text-[0.6875rem] font-medium text-muted">
                Provider
              </label>
              <Select
                id="default-provider"
                inputSize="md"
                value={defaultProvider}
                onChange={(e) => {
                  setDefaultProvider(e.target.value);
                  setDefaultModel(""); // Reset model when provider changes
                }}
              >
                <option value="">System default</option>
                {providers.map((p) => (
                  <option key={p.provider} value={p.provider}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="default-model" className="text-[0.6875rem] font-medium text-muted">
                Model
              </label>
              <Select
                id="default-model"
                inputSize="md"
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                disabled={!defaultProvider}
              >
                <option value="">System default</option>
                {models
                  .filter((m) => !m.hidden)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
              </Select>
            </div>
          </div>
          <OverrideIndicator
            providers={providers}
            globalSettings={globalSettings}
            projectProvider={defaultProvider}
            projectModel={defaultModel}
          />
        </section>

        {/* Save */}
        <div className="flex items-center justify-end gap-3 border-t border-border/70 pt-4">
          <Button
            variant="primary"
            size="sm"
            disabled={!hasChanges || saveMutation.isPending}
            onClick={handleSave}
          >
            <Save size={14} />
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </div>
      </div>
    </PageShell>
  );
}

// ─── Override Indicator ──────────────────────────────────────────────────

function OverrideIndicator({
  providers,
  globalSettings,
  projectProvider,
  projectModel,
}: {
  providers: { provider: string; label: string }[];
  globalSettings: GlobalSettings | undefined;
  projectProvider: string;
  projectModel: string;
}) {
  if (!globalSettings) return null;

  const globalProvider = globalSettings.defaultProvider ?? "";
  const globalModel = globalSettings.defaultModel ?? "";

  const hasProviderOverride = projectProvider !== "" && projectProvider !== globalProvider;
  // Only compare models when the provider is the same — models from different providers aren't comparable
  const sameProvider = !hasProviderOverride || projectProvider === "";
  const hasModelOverride = sameProvider && projectModel !== "" && projectModel !== globalModel;

  if (!hasProviderOverride && !hasModelOverride) return null;

  const globalProviderLabel =
    providers.find((p) => p.provider === globalProvider)?.label ?? (globalProvider || "none");

  const parts: string[] = [];
  if (hasProviderOverride) {
    parts.push(`provider (global default: ${globalProviderLabel})`);
  }
  if (hasModelOverride) {
    parts.push(`model (global default: ${globalModel || "auto"})`);
  }

  return (
    <div className="flex items-start gap-2 rounded-md bg-accent/5 px-3 py-2 text-[0.75rem] text-accent">
      <Info size={14} className="mt-0.5 shrink-0" />
      <span>Overriding global default {parts.join(" and ")}</span>
    </div>
  );
}
