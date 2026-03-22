import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, FileText } from "lucide-react";
import { fetchProject, updateProject, fetchProviders, fetchProviderModels } from "../lib/api";
import { useProjectContext } from "../context/project-context";
import { Input, Textarea, Select } from "../components/ui/input";
import { Button } from "../components/ui/button";
import type { ProviderKind } from "@shared/types";

// ─── Settings Page ──────────────────────────────────────────────────────────

export function SettingsPage() {
  const { artifacts } = useProjectContext();
  const projectId = artifacts.projectId;
  const queryClient = useQueryClient();

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
  });

  const { data: providers = [] } = useQuery({
    queryKey: ["providers"],
    queryFn: fetchProviders,
  });

  // Form state
  const [customInstructions, setCustomInstructions] = useState("");
  const [defaultSpaceBranch, setDefaultSpaceBranch] = useState("");
  const [defaultProvider, setDefaultProvider] = useState("");
  const [defaultModel, setDefaultModel] = useState("");

  // Sync form state when project loads
  useEffect(() => {
    if (project) {
      setCustomInstructions(project.customInstructions ?? "");
      setDefaultSpaceBranch(project.defaultSpaceBranch ?? "");
      setDefaultProvider(project.defaultProvider ?? "");
      setDefaultModel(project.defaultModel ?? "");
    }
  }, [project]);

  // Fetch models for selected provider
  const { data: providerModels } = useQuery({
    queryKey: ["provider-models", defaultProvider],
    queryFn: () => fetchProviderModels(defaultProvider as ProviderKind),
    enabled: !!defaultProvider,
  });
  const models = providerModels?.models ?? [];

  // Track if form has changes
  const hasChanges =
    project != null &&
    (customInstructions !== (project.customInstructions ?? "") ||
      defaultSpaceBranch !== (project.defaultSpaceBranch ?? "") ||
      defaultProvider !== (project.defaultProvider ?? "") ||
      defaultModel !== (project.defaultModel ?? ""));

  const saveMutation = useMutation({
    mutationFn: () =>
      updateProject(projectId, {
        customInstructions: customInstructions.trim() || null,
        defaultSpaceBranch: defaultSpaceBranch.trim() || null,
        defaultProvider: defaultProvider || null,
        defaultModel: defaultModel || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      toast.success("Settings saved");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to save settings");
    },
  });

  const handleSave = useCallback(() => {
    saveMutation.mutate();
  }, [saveMutation]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted">Loading settings...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl space-y-8 px-6 py-6">
        {/* Custom Instructions */}
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-text-bright">Custom Instructions</h2>
            <p className="mt-0.5 text-[0.75rem] text-muted">
              Instructions injected into every new session for this project. These guide the model's
              behavior — add coding standards, architecture notes, or style conventions.
            </p>
          </div>
          <Textarea
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
            <h2 className="text-sm font-semibold text-text-bright">Default Space Branch</h2>
            <p className="mt-0.5 text-[0.75rem] text-muted">
              The base branch for new spaces. If empty, the current branch is used.
            </p>
          </div>
          <Input
            value={defaultSpaceBranch}
            onChange={(e) => setDefaultSpaceBranch(e.target.value)}
            placeholder="e.g. main"
          />
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[0.6875rem] font-medium text-muted">Provider</label>
              <Select
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
            <div className="space-y-1.5">
              <label className="text-[0.6875rem] font-medium text-muted">Model</label>
              <Select
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
    </div>
  );
}
