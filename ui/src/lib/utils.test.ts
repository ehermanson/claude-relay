import { describe, expect, it } from "vitest";
import { getDisplaySessionStats, getDisplayTokenBreakdown } from "./utils";

describe("token display normalization", () => {
  it("keeps Claude input tokens unchanged", () => {
    expect(
      getDisplaySessionStats("claude", {
        inputTokens: 1000,
        outputTokens: 200,
        cacheCreationTokens: 50,
        cacheReadTokens: 300,
      }),
    ).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      cacheCreationTokens: 50,
      cacheReadTokens: 300,
      totalTokens: 1550,
    });
  });

  it("subtracts Codex cache reads from displayed input totals", () => {
    expect(
      getDisplaySessionStats("codex", {
        inputTokens: 2300000,
        outputTokens: 16700,
        cacheCreationTokens: 142800,
        cacheReadTokens: 2200000,
      }),
    ).toEqual({
      inputTokens: 100000,
      outputTokens: 16700,
      cacheCreationTokens: 142800,
      cacheReadTokens: 2200000,
      totalTokens: 2459500,
    });
  });

  it("normalizes model usage totals for Codex", () => {
    expect(
      getDisplayTokenBreakdown({
        providerName: "codex",
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 0,
        cacheReadTokens: 200,
      }),
    ).toEqual({
      inputTokens: 800,
      outputTokens: 500,
      cacheTokens: 200,
      totalTokens: 1500,
    });
  });
});
