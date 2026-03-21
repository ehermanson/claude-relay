import type { ProviderCapabilities, ProviderKind, ProviderModelOption } from "./types.js";

export const PROVIDER_DISPLAY_NAMES: Record<ProviderKind, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini",
};

export const BUILTIN_PROVIDER_MODELS: Record<ProviderKind, readonly ProviderModelOption[]> = {
  claude: [
    {
      provider: "claude",
      id: "claude-opus-4-6",
      label: "Opus 4.6",
      isDefault: true,
    },
    {
      provider: "claude",
      id: "claude-sonnet-4-6",
      label: "Sonnet 4.6",
    },
    {
      provider: "claude",
      id: "claude-haiku-4-5-20251001",
      label: "Haiku 4.5",
    },
  ],
  codex: [
    {
      provider: "codex",
      id: "gpt-5.4",
      label: "GPT-5.4",
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
    supportsReasoningBudget: true,
    supportsReasoningEffort: false,
    supportsFastMode: false,
    supportsPlanMode: true,
    supportsModelSelection: true,
    supportsTitleUpdates: false,
    reasoningBudgetLevels: [
      { budget: 5000, label: "Low", description: "Fastest responses with light reasoning" },
      { budget: 10000, label: "Medium", description: "Balanced depth and speed" },
      { budget: 30000, label: "High", description: "More reasoning for harder tasks" },
      { budget: 100000, label: "Max", description: "Deepest reasoning, usually slower" },
    ],
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
    supportsReasoningBudget: false,
    supportsReasoningEffort: true,
    supportsFastMode: true,
    supportsPlanMode: true,
    supportsModelSelection: true,
    supportsTitleUpdates: true,
    reasoningEffortLevels: [
      { effort: "low", label: "Low", description: "Fastest responses, minimal reasoning" },
      { effort: "medium", label: "Medium", description: "Balanced depth and speed" },
      { effort: "high", label: "High", description: "More reasoning for harder tasks" },
      { effort: "max", label: "Max", description: "Deepest reasoning, usually slower" },
    ],
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
    supportsReasoningBudget: false,
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

export function findProviderModelLabel(provider: ProviderKind, modelId: string): string | null {
  return BUILTIN_PROVIDER_MODELS[provider].find((model) => model.id === modelId)?.label ?? null;
}
