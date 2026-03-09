import type { ProviderKind, ProviderModelOption } from "./types.js";

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

export function getProviderDisplayName(provider: ProviderKind): string {
  return PROVIDER_DISPLAY_NAMES[provider];
}

export function getBuiltinProviderModels(provider: ProviderKind): ProviderModelOption[] {
  return BUILTIN_PROVIDER_MODELS[provider].map((model) => ({ ...model }));
}

export function findProviderModelLabel(provider: ProviderKind, modelId: string): string | null {
  return BUILTIN_PROVIDER_MODELS[provider].find((model) => model.id === modelId)?.label ?? null;
}
