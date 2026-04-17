import type {
  ProviderCapabilities,
  ProviderKind,
  ProviderModelOption,
  ReasoningEffort,
} from "#core/types.js";

export const PROVIDER_DISPLAY_NAMES: Record<ProviderKind, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
};

const REASONING_LEVEL_DEFS: Record<ReasoningEffort, { label: string; description: string }> = {
  low: { label: "Low", description: "Fastest responses, minimal reasoning" },
  medium: { label: "Medium", description: "Balanced depth and speed" },
  high: { label: "High", description: "More reasoning for harder tasks" },
  xhigh: { label: "Extra High", description: "Extended reasoning for complex tasks" },
  max: { label: "Max", description: "Deepest reasoning, usually slower" },
};

type ReasoningLevel = {
  effort: ReasoningEffort;
  label: string;
  description: string;
  isDefault?: boolean;
};

function reasoningLevels(
  defaultEffort: ReasoningEffort,
  ...efforts: ReasoningEffort[]
): ReasoningLevel[] {
  return efforts.map((effort) => ({
    effort,
    ...REASONING_LEVEL_DEFS[effort],
    ...(effort === defaultEffort ? { isDefault: true } : {}),
  }));
}

const STANDARD_EFFORTS = reasoningLevels("medium", "low", "medium", "high", "max");
const EXTENDED_EFFORTS = reasoningLevels("xhigh", "low", "medium", "high", "xhigh", "max");

export const BUILTIN_PROVIDER_MODELS: Record<ProviderKind, readonly ProviderModelOption[]> = {
  claude: [
    {
      provider: "claude",
      id: "claude-opus-4-7",
      label: "Opus 4.7",
      isDefault: true,
      capabilities: { reasoningEffortLevels: EXTENDED_EFFORTS },
    },
    {
      provider: "claude",
      id: "claude-opus-4-6",
      label: "Opus 4.6",
      capabilities: { reasoningEffortLevels: STANDARD_EFFORTS },
    },
    {
      provider: "claude",
      id: "claude-sonnet-4-6",
      label: "Sonnet 4.6",
      capabilities: { reasoningEffortLevels: STANDARD_EFFORTS },
    },
    {
      provider: "claude",
      id: "claude-haiku-4-5-20251001",
      label: "Haiku 4.5",
      capabilities: { reasoningEffortLevels: STANDARD_EFFORTS },
    },
  ],
  codex: [
    {
      provider: "codex",
      id: "gpt-5.4",
      label: "GPT-5.4",
      isDefault: true,
    },
    {
      provider: "codex",
      id: "gpt-5.3-codex",
      label: "GPT-5.3 Codex",
    },
    {
      provider: "codex",
      id: "gpt-5.3-codex-spark",
      label: "GPT-5.3 Codex Spark",
    },
    {
      provider: "codex",
      id: "gpt-5.2-codex",
      label: "GPT-5.2 Codex",
    },
    {
      provider: "codex",
      id: "gpt-5.2",
      label: "GPT-5.2",
    },
  ],
  gemini: [],
};

export const DEFAULT_PROVIDER_CAPABILITIES: Record<ProviderKind, ProviderCapabilities> = {
  claude: {
    supportsResume: true,
    supportsTranscriptReplay: true,
    supportsApprovals: true,
    supportsUserInputRequests: true,
    supportsReasoningEffort: true,
    supportsFastMode: false,
    supportsPlanMode: true,
    supportsModelSelection: true,
    supportsTitleUpdates: false,
    reasoningEffortLevels: EXTENDED_EFFORTS,
    permissionModes: {
      restricted: {
        label: "Ask Permission",
        description: "Ask before running commands or editing files",
      },
      fullAccess: {
        label: "Full access",
        description: "Run commands and edit files without asking",
      },
    },
    planModes: {
      off: { label: "Build", description: "Standard working mode" },
      on: { label: "Plan", description: "Stay in planning mode for this chat" },
    },
  },
  codex: {
    supportsResume: true,
    supportsTranscriptReplay: true,
    supportsApprovals: true,
    supportsUserInputRequests: true,
    supportsReasoningEffort: true,
    supportsFastMode: true,
    supportsPlanMode: true,
    supportsModelSelection: true,
    supportsTitleUpdates: true,
    reasoningEffortLevels: STANDARD_EFFORTS,
    fastModes: {
      off: { label: "Standard", description: "Default speed with normal credit usage" },
      on: { label: "Fast", description: "About 1.5x faster, with credits used at 2x" },
    },
    permissionModes: {
      restricted: { label: "Sandboxed", description: "Run commands in a workspace sandbox" },
      fullAccess: { label: "Full access", description: "Run commands directly without sandboxing" },
    },
    planModes: {
      off: { label: "Build", description: "Standard working mode" },
      on: { label: "Plan", description: "Stay in planning mode for this chat" },
    },
  },
  gemini: {
    supportsResume: false,
    supportsTranscriptReplay: false,
    supportsApprovals: false,
    supportsUserInputRequests: false,
    supportsReasoningEffort: false,
    supportsFastMode: false,
    supportsPlanMode: false,
    supportsModelSelection: true,
    supportsTitleUpdates: false,
    permissionModes: {
      restricted: {
        label: "Ask Permission",
        description: "Ask before running commands or editing files",
      },
      fullAccess: {
        label: "Full access",
        description: "Run commands and edit files without asking",
      },
    },
  },
};

export function getProviderDisplayName(provider: ProviderKind): string {
  return PROVIDER_DISPLAY_NAMES[provider];
}

export function getBuiltinProviderModels(provider: ProviderKind): ProviderModelOption[] {
  return BUILTIN_PROVIDER_MODELS[provider].map((model) => ({ ...model }));
}

export function getDefaultProviderCapabilities(provider: ProviderKind): ProviderCapabilities {
  return DEFAULT_PROVIDER_CAPABILITIES[provider];
}

export function resolveProviderDefaultModelOption(
  provider: ProviderKind,
  models?: readonly ProviderModelOption[],
): ProviderModelOption | undefined {
  const catalogModels = BUILTIN_PROVIDER_MODELS[provider];
  const candidateModels = models && models.length > 0 ? models : catalogModels;
  if (candidateModels.length === 0) return undefined;
  // Prefer the catalog's declared default by id (so an enriched model from
  // `models` — with resolvedCapabilities etc. — wins over the raw catalog
  // entry). Fall back to any isDefault model in the candidate list, then the
  // first candidate.
  const catalogDefault = catalogModels.find((model) => model.isDefault);
  return (
    (catalogDefault && candidateModels.find((model) => model.id === catalogDefault.id)) ??
    candidateModels.find((model) => model.isDefault) ??
    candidateModels[0]
  );
}

export function findProviderModelLabel(provider: ProviderKind, modelId: string): string | null {
  return BUILTIN_PROVIDER_MODELS[provider].find((model) => model.id === modelId)?.label ?? null;
}

/**
 * Compute effective capabilities for a given (provider, model) pair.
 * Per-model capability overrides win over provider defaults; omitted fields
 * inherit. Pass `undefined` for `modelCapabilities` to get plain provider
 * capabilities back.
 *
 * Per-model overrides are *partial* — an override only covers the keys it
 * sets. Notably, if a model overrides `reasoningEffortLevels` it replaces
 * the array wholesale (not a per-entry merge).
 */
export function mergeCapabilities(
  providerCapabilities: ProviderCapabilities,
  modelCapabilities: Partial<ProviderCapabilities> | undefined,
): ProviderCapabilities {
  if (!modelCapabilities) return providerCapabilities;
  return { ...providerCapabilities, ...modelCapabilities };
}
