import { describe, expect, it } from "vitest";
import type { ProviderModelsResponse } from "@shared/types";
import { getDefaultProviderCapabilities } from "@shared/provider-catalog";
import { providerModelsRefetchInterval } from "./use-provider-models";

function response(withAdvisory: boolean): ProviderModelsResponse {
  const capabilities = getDefaultProviderCapabilities("codex");
  return {
    provider: "codex",
    models: [],
    capabilities: withAdvisory
      ? {
          ...capabilities,
          versionAdvisory: {
            status: "current",
            currentVersion: "0.144.0",
            latestVersion: "0.144.0",
            packageName: "@openai/codex",
            updateCommand: null,
            installMethod: "manual",
            checkedAt: "2026-07-16T00:00:00.000Z",
          },
        }
      : capabilities,
  };
}

describe("providerModelsRefetchInterval", () => {
  it("polls during bootstrap until provider version capabilities resolve", () => {
    expect(providerModelsRefetchInterval(undefined)).toBe(5_000);
    expect(providerModelsRefetchInterval(response(false))).toBe(5_000);
  });

  it("stops polling after the version advisory arrives", () => {
    expect(providerModelsRefetchInterval(response(true))).toBe(false);
  });
});
