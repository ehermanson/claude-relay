import { useRef, useCallback, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  DownloadCloud,
  Loader2,
  Monitor,
  Moon,
  RefreshCw,
  Sun,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import {
  createPairingCode,
  fetchConnectEndpoints,
  fetchHealth,
  fetchGlobalSettings,
  updateGlobalSettings,
  fetchProviders,
  fetchProviderModels,
} from "../lib/api";
import { useSystemUpdate, describeUpdateStage } from "@/hooks/use-system-update";

import { Button } from "@/components/ui/button";
import { Input, Textarea, Select } from "../components/ui/input";
import { RadioGroup, RadioGroupField } from "@/components/ui/radio-group";
import { ProviderLogo } from "@/components/ui/provider-logo";
import { RateLimitBar, flattenRateLimitWindows } from "@/components/ui/rate-limit-bar";
import { SettingsSection, SettingRow } from "@/components/settings/settings-shared";
import { SuggestionSettings } from "@/components/settings/suggestion-settings";
import { endpointHint, isLocalhostUrl, resolveEndpointSelection } from "@/lib/remote-access";
import { useThemeStore, type ThemePreference } from "@/stores/theme-store";
import { useProviderRuntimeStore } from "@/stores/provider-runtime-store";
import type {
  GlobalSettings,
  ProviderDefaults,
  ProviderDescriptor,
  ProviderGlobalState,
  UpdateSnapshot,
} from "@shared/types";

// ─── Helpers ───────────────────────────────────────────────────────────────

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
  projectOrder: null,
  suggestions: null,
};

const REMOTE_ACCESS_ENDPOINT_KEY = "relay.remoteAccess.endpoint";

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
      queryClient.invalidateQueries({ queryKey: ["project-suggestions"] });
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
      <UpdateSettingsRow />
      <RemoteAccessSettingsRow />
    </SettingsSection>
  );
}

function formatShortCommit(commit: string | null | undefined): string | null {
  return commit ? commit.slice(0, 7) : null;
}

function formatCheckedAt(checkedAt: number | null | undefined): string | null {
  if (!checkedAt) return null;
  const diffMs = Date.now() - checkedAt;
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type UpdateStatusTone = "neutral" | "info" | "success" | "warn" | "error";

interface UpdateStatusDescriptor {
  title: string;
  tone: UpdateStatusTone;
  icon: typeof CheckCircle2;
  spin?: boolean;
}

function getUpdateStatus(snapshot: UpdateSnapshot | undefined): UpdateStatusDescriptor {
  if (!snapshot) {
    return { title: "Checking availability…", tone: "neutral", icon: Loader2, spin: true };
  }
  if (!snapshot.enabled) {
    return {
      title: snapshot.error ?? "Updates are unavailable for this checkout",
      tone: "neutral",
      icon: AlertCircle,
    };
  }
  switch (snapshot.status) {
    case "checking":
      return { title: "Checking for updates…", tone: "info", icon: Loader2, spin: true };
    case "updating":
      return {
        title: describeUpdateStage(snapshot.status, snapshot.stage) ?? "Installing update…",
        tone: "info",
        icon: Loader2,
        spin: true,
      };
    case "restart_pending":
      return { title: "Restarting Relay…", tone: "info", icon: Loader2, spin: true };
    case "available":
      return { title: "Update available", tone: "warn", icon: DownloadCloud };
    case "up_to_date":
      return { title: "Relay is up to date", tone: "success", icon: CheckCircle2 };
    case "error":
      return { title: snapshot.error ?? "Update check failed", tone: "error", icon: AlertCircle };
    default:
      return { title: "Not checked yet", tone: "neutral", icon: RefreshCw };
  }
}

const STATUS_TONE_STYLES: Record<UpdateStatusTone, { icon: string; bg: string }> = {
  neutral: { icon: "text-muted", bg: "bg-surface/70" },
  info: { icon: "text-accent", bg: "bg-accent/10" },
  success: { icon: "text-emerald-400", bg: "bg-emerald-500/10" },
  warn: { icon: "text-amber-400", bg: "bg-amber-500/10" },
  error: { icon: "text-error", bg: "bg-error/10" },
};

function UpdateSettingsRow() {
  const [restartRequested, setRestartRequested] = useState(false);

  const {
    snapshot,
    isLoading,
    isBusy,
    isInstalling,
    canInstall,
    install,
    check,
    installPending,
    checkPending,
  } = useSystemUpdate();

  useEffect(() => {
    if (installPending) {
      setRestartRequested(true);
    }
  }, [installPending]);

  useEffect(() => {
    if (!restartRequested || !snapshot) return;
    if (
      snapshot.status !== "restart_pending" &&
      snapshot.status !== "updating" &&
      !snapshot.updateAvailable
    ) {
      setRestartRequested(false);
    }
  }, [restartRequested, snapshot]);

  const currentCommit = formatShortCommit(snapshot?.currentCommit);
  const latestCommit = formatShortCommit(snapshot?.latestCommit);
  const status =
    restartRequested && snapshot?.status !== "restart_pending" && snapshot?.status !== "updating"
      ? {
          title: "Waiting for Relay to restart…",
          tone: "info" as const,
          icon: Loader2,
          spin: true,
        }
      : getUpdateStatus(snapshot);
  const tone = STATUS_TONE_STYLES[status.tone];
  const StatusIcon = status.icon;
  const checkedLabel = formatCheckedAt(snapshot?.checkedAt);
  const showCommitDiff = snapshot?.updateAvailable && latestCommit && currentCommit;
  const isUnavailable = Boolean(!isLoading && snapshot && !snapshot.enabled);
  const installButtonLabel = isInstalling
    ? (describeUpdateStage(snapshot?.status, snapshot?.stage) ?? "Installing…")
    : "Update and Restart";
  // The status icon is clickable to re-check when idle and enabled.
  const iconIsClickable = Boolean(snapshot?.enabled && !isBusy && !status.spin);

  return (
    <SettingRow
      label="Relay Updates"
      description="Check whether this Relay checkout is behind GitHub and update it in place."
      vertical
    >
      <div className="overflow-hidden rounded-xl border border-border/70 bg-surface/30">
        <div className="flex items-start gap-3 p-4">
          {iconIsClickable ? (
            <Tooltip content="Check for updates" side="right">
              <button
                type="button"
                onClick={() => check(true)}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-opacity ${tone.bg} cursor-pointer hover:opacity-75 active:opacity-60`}
              >
                <StatusIcon size={18} className={tone.icon} />
              </button>
            </Tooltip>
          ) : (
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.bg}`}
            >
              <StatusIcon
                size={18}
                className={`${tone.icon} ${status.spin ? "animate-spin" : ""}`}
              />
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="text-[0.8125rem] font-medium text-text-bright">{status.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.75rem] text-muted">
              {showCommitDiff ? (
                <>
                  <span className="font-mono text-muted">{currentCommit}</span>
                  <span className="text-border">→</span>
                  <span className="font-mono text-text">{latestCommit}</span>
                </>
              ) : currentCommit ? (
                <span className="font-mono">{currentCommit}</span>
              ) : null}
              {checkedLabel && snapshot?.enabled && (
                <>
                  {currentCommit && <span className="text-border">·</span>}
                  <span>Checked {checkedLabel}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border/60 bg-surface/40 px-4 py-3">
          {isUnavailable && (
            <div className="text-[0.75rem] text-muted">
              Available only in installed production builds. Dev/source checkouts don&apos;t
              self-update.
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => check(true)}
              disabled={isBusy || !snapshot?.enabled || isLoading}
            >
              <RefreshCw
                size={12}
                className={checkPending || snapshot?.status === "checking" ? "animate-spin" : ""}
              />
              Check
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => install()}
              disabled={!canInstall}
            >
              {isInstalling ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <DownloadCloud size={13} />
              )}
              {installButtonLabel}
            </Button>
          </div>
        </div>
      </div>
    </SettingRow>
  );
}

function RemoteAccessSettingsRow() {
  const [pairing, setPairing] = useState<{
    code: string;
    createdAt: number;
    expiresAt: number;
  } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedEndpointId, setSelectedEndpointId] = useState("");

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    staleTime: 60_000,
  });

  const { data: connectData } = useQuery({
    queryKey: ["connect-endpoints"],
    queryFn: fetchConnectEndpoints,
    staleTime: 60_000,
  });

  const browserEndpoint =
    typeof window !== "undefined"
      ? {
          id: "browser",
          label: `Current Browser URL (${window.location.host})`,
          url: window.location.origin,
          kind: "browser" as const,
        }
      : null;

  const endpointOptions = [
    ...(browserEndpoint ? [browserEndpoint] : []),
    ...(connectData?.endpoints ?? []),
  ].filter(
    (endpoint, index, all) => all.findIndex((entry) => entry.url === endpoint.url) === index,
  );

  useEffect(() => {
    if (endpointOptions.length === 0) return;
    if (
      selectedEndpointId &&
      endpointOptions.some((endpoint) => endpoint.id === selectedEndpointId)
    ) {
      return;
    }
    const storedId =
      typeof window !== "undefined"
        ? window.localStorage.getItem(REMOTE_ACCESS_ENDPOINT_KEY)
        : null;
    setSelectedEndpointId(resolveEndpointSelection(endpointOptions, storedId));
  }, [endpointOptions, selectedEndpointId]);

  useEffect(() => {
    if (!selectedEndpointId || typeof window === "undefined") return;
    window.localStorage.setItem(REMOTE_ACCESS_ENDPOINT_KEY, selectedEndpointId);
  }, [selectedEndpointId]);

  const selectedEndpoint =
    endpointOptions.find((endpoint) => endpoint.id === selectedEndpointId) ??
    endpointOptions[0] ??
    null;

  const baseUrl =
    selectedEndpoint?.url ?? (typeof window !== "undefined" ? window.location.origin : "");
  const phoneUrl = !health?.authRequired
    ? `${baseUrl}/`
    : pairing
      ? `${baseUrl}/login?pairCode=${encodeURIComponent(pairing.code)}`
      : `${baseUrl}/login`;

  const expiresLabel = pairing ? new Date(pairing.expiresAt).toLocaleTimeString() : null;

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const next = await createPairingCode();
      setPairing(next);
      toast.success("Pairing code created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create pairing code");
    } finally {
      setIsGenerating(false);
    }
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}`);
    }
  };

  return (
    <SettingRow
      label="Open On Phone"
      description="Pick a reachable address for this machine, then scan a QR code to open Relay on another device."
      vertical
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-border/70 bg-surface/30 p-4 text-[0.75rem] text-muted">
          {health?.authRequired
            ? "Relay is password-protected. Scanning the QR code will open the login page, and you can optionally generate a one-time pairing code so your phone opens already prefilled."
            : "Relay is running in open mode. Scanning the QR code opens the Relay UI directly on your phone."}
        </div>

        <div className="rounded-xl border border-border/70 bg-surface/40 p-4">
          <div className="grid gap-4 md:grid-cols-[172px_minmax(0,1fr)] md:items-start">
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-white p-3">
              <QRCodeSVG
                value={phoneUrl}
                size={148}
                marginSize={2}
                bgColor="#ffffff"
                fgColor="#111111"
                level="M"
                includeMargin={false}
              />
              <div className="text-center text-[0.6875rem] uppercase tracking-[0.18em] text-black/60">
                Scan to open
              </div>
            </div>

            <div className="space-y-3">
              {endpointOptions.length > 0 ? (
                <div className="space-y-1.5">
                  <div className="text-[0.6875rem] uppercase tracking-[0.18em] text-muted">
                    Device Address
                  </div>
                  <Select
                    value={selectedEndpointId}
                    onChange={(e) => setSelectedEndpointId(e.target.value)}
                    className="w-full"
                  >
                    {endpointOptions.map((endpoint) => (
                      <option key={endpoint.id} value={endpoint.id}>
                        {endpoint.label}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}

              <div className="text-[0.75rem] text-muted">{endpointHint(selectedEndpoint)}</div>

              {selectedEndpoint ? (
                <div className="flex flex-wrap gap-2 text-[0.6875rem]">
                  <span className="rounded bg-surface px-1.5 py-0.5 font-medium text-text">
                    {selectedEndpoint.kind === "browser"
                      ? "Current URL"
                      : selectedEndpoint.kind === "tailscale"
                        ? "Tailscale"
                        : selectedEndpoint.kind === "lan"
                          ? "LAN"
                          : "Local Only"}
                  </span>
                  {!isLocalhostUrl(selectedEndpoint.url) ? (
                    <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 font-medium text-emerald-400">
                      Phone-ready
                    </span>
                  ) : null}
                </div>
              ) : null}

              {endpointOptions.length > 1 ? (
                <div className="text-[0.75rem] text-muted">
                  Relay will remember this address the next time you open Settings.
                </div>
              ) : null}

              <div className="space-y-1.5">
                <div className="text-[0.6875rem] uppercase tracking-[0.18em] text-muted">
                  Phone Link
                </div>
                <Input readOnly value={phoneUrl} className="w-full font-mono text-[0.75rem]" />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void copyText(phoneUrl, "Link")}
                  className="border border-border text-text"
                >
                  Copy Link
                </Button>
              </div>

              {health?.authRequired ? (
                <div className="rounded-lg border border-border/60 bg-bg/35 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => void handleGenerate()}
                      disabled={isGenerating}
                    >
                      {isGenerating
                        ? "Generating..."
                        : pairing
                          ? "Regenerate Pairing Code"
                          : "Generate Pairing Code"}
                    </Button>
                    {expiresLabel ? (
                      <span className="text-[0.75rem] text-muted">Expires at {expiresLabel}</span>
                    ) : null}
                  </div>

                  {pairing ? (
                    <div className="mt-3 space-y-3">
                      <div>
                        <div className="text-[0.6875rem] uppercase tracking-[0.18em] text-muted">
                          Pairing Code
                        </div>
                        <div className="mt-2 font-mono text-2xl font-semibold tracking-[0.24em] text-text-bright">
                          {pairing.code}
                        </div>
                      </div>

                      <div className="text-[0.75rem] text-muted">
                        The QR code and phone link above now open a login page with this code
                        prefilled.
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void copyText(pairing.code, "Code")}
                          className="border border-border text-text"
                        >
                          Copy Code
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 text-[0.75rem] text-muted">
                      Without a pairing code, your phone will open the normal login page.
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </SettingRow>
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
  const providerGlobalState = useProviderRuntimeStore((s) => s.providerGlobalState);

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
    if (field === "fastMode" && value) {
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
          runtimeState={providerGlobalState[p.provider]}
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
  runtimeState,
}: {
  provider: ProviderDescriptor;
  defaults: ProviderDefaults;
  onChange: (field: keyof ProviderDefaults, value: string) => void;
  runtimeState?: ProviderGlobalState;
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

  // Per-model capabilities: reasoning effort levels and fast mode vary by model
  // (e.g. xhigh only on Opus 4.7). Use the selected model's resolvedCapabilities
  // so the controls reflect what that model actually supports.
  const selectedModel = defaults.model ? models.find((m) => m.id === defaults.model) : defaultModel;
  const modelCaps = selectedModel?.resolvedCapabilities ?? caps;
  const defaultRuntimeLabel = caps.runtimeModes?.["approval-required"]?.label;

  const hasAnyControls =
    caps.supportsModelSelection ||
    (caps.supportsReasoningEffort && caps.reasoningEffortLevels) ||
    !!caps.runtimeModes ||
    (caps.supportsFastMode && caps.fastModes);

  const hasRuntime = runtimeState != null;
  const accountLabel =
    runtimeState?.account?.label ?? runtimeState?.account?.email ?? runtimeState?.account?.plan;

  if (!hasAnyControls && !hasRuntime) return null;

  return (
    <div className="py-5">
      <div className="flex items-center gap-2.5 mb-4">
        <ProviderLogo provider={provider.provider} className="h-4 w-4" />
        <div>
          <div className="text-[0.8125rem] font-medium text-text-bright">{provider.label}</div>
          <div className="mt-0.5 text-[0.75rem] text-muted">
            Saved defaults when using {provider.label}.
          </div>
        </div>
      </div>

      {hasAnyControls && (
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
          {modelCaps.supportsReasoningEffort && modelCaps.reasoningEffortLevels && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.6875rem] font-medium text-muted">Reasoning</label>
              <Select
                inputSize="md"
                value={defaults.reasoningEffort ?? ""}
                onChange={(e) => onChange("reasoningEffort", e.target.value)}
              >
                <option value="">
                  {modelCaps.reasoningEffortLevels.find((l) => l.isDefault)?.label ?? "Medium"}{" "}
                  (default)
                </option>
                {modelCaps.reasoningEffortLevels.map((level) => (
                  <option key={level.effort} value={level.effort}>
                    {level.label}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {caps.runtimeModes && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.6875rem] font-medium text-muted">Mode</label>
              <Select
                inputSize="md"
                value={defaults.runtimeMode ?? ""}
                onChange={(e) => onChange("runtimeMode", e.target.value)}
              >
                <option value="">
                  {defaultRuntimeLabel ? `${defaultRuntimeLabel} (default)` : "Default"}
                </option>
                {(["approval-required", "full-access", "plan"] as const)
                  .filter((mode) => caps.runtimeModes?.[mode])
                  .map((mode) => (
                    <option key={mode} value={mode}>
                      {caps.runtimeModes![mode]!.label}
                    </option>
                  ))}
              </Select>
            </div>
          )}
          {modelCaps.supportsFastMode && modelCaps.fastModes && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[0.6875rem] font-medium text-muted">Speed</label>
              <Select
                inputSize="md"
                value={defaults.fastMode != null ? String(defaults.fastMode) : ""}
                onChange={(e) => onChange("fastMode", e.target.value)}
              >
                <option value="">{modelCaps.fastModes.off.label} (default)</option>
                <option value="true">{modelCaps.fastModes.on.label}</option>
                <option value="false">{modelCaps.fastModes.off.label}</option>
              </Select>
            </div>
          )}
        </div>
      )}

      {/* Runtime state (account, MCP, rate limits) */}
      {hasRuntime && (
        <div className={`pl-7 ${hasAnyControls ? "mt-4 border-t border-border/30 pt-4" : ""}`}>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[0.75rem]">
            {accountLabel && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-[0.6875rem] text-muted">Account</span>
                <span className="font-medium text-text-bright">{accountLabel}</span>
              </div>
            )}
            {runtimeState?.account?.plan && runtimeState.account.plan !== accountLabel && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-[0.6875rem] text-muted">Plan</span>
                <span className="font-medium text-text-bright capitalize">
                  {runtimeState.account.plan}
                </span>
              </div>
            )}
            {typeof runtimeState?.mcpServers?.length === "number" && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-[0.6875rem] text-muted">MCP Servers</span>
                <span className="font-medium text-text-bright">
                  {runtimeState.mcpServers.length}
                </span>
              </div>
            )}
          </div>
          {runtimeState?.account?.rateLimits?.length ? (
            <div className="mt-3 space-y-2">
              <div className="text-[0.6875rem] text-muted">Rate Limits</div>
              {flattenRateLimitWindows(runtimeState.account.rateLimits).map(({ window, key }) => (
                <RateLimitBar key={key} window={window} size="md" />
              ))}
            </div>
          ) : null}
        </div>
      )}
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

// ─── Suggestions Section ─────────────────────────────────────────────────

export function SuggestionsSettingsSection() {
  const { data: settings } = useGlobalSettings();
  const save = useAutoSave();

  return (
    <SuggestionSettings
      config={settings?.suggestions}
      onChange={(suggestions) => save.mutate({ suggestions })}
      title="Suggestions"
      description="Customize the prompt suggestions shown on new chats. Projects can further customize these."
    />
  );
}
