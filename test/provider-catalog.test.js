import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getProviderDisplayName,
  getBuiltinProviderModels,
  findProviderModelLabel,
  getDefaultProviderCapabilities,
} from "../dist/server/core/provider-catalog.js";

describe("getProviderDisplayName", () => {
  it("returns 'Claude Code' for claude", () => {
    assert.equal(getProviderDisplayName("claude"), "Claude Code");
  });

  it("returns 'Codex' for codex", () => {
    assert.equal(getProviderDisplayName("codex"), "Codex");
  });

  it("returns 'Gemini' for gemini", () => {
    assert.equal(getProviderDisplayName("gemini"), "Gemini");
  });
});

describe("getBuiltinProviderModels", () => {
  it("returns claude models with correct structure", () => {
    const models = getBuiltinProviderModels("claude");
    assert.ok(models.length > 0);

    for (const model of models) {
      assert.equal(model.provider, "claude");
      assert.ok(typeof model.id === "string");
      assert.ok(typeof model.label === "string");
    }
  });

  it("returns codex models with correct structure", () => {
    const models = getBuiltinProviderModels("codex");
    assert.ok(models.length > 0);

    for (const model of models) {
      assert.equal(model.provider, "codex");
    }
  });

  it("claude has exactly one default model", () => {
    const models = getBuiltinProviderModels("claude");
    const defaults = models.filter((m) => m.isDefault);
    assert.equal(defaults.length, 1);
  });

  it("returns copies, not references to the source data", () => {
    const first = getBuiltinProviderModels("claude");
    const second = getBuiltinProviderModels("claude");
    assert.notEqual(first[0], second[0]);
    assert.deepEqual(first, second);
  });

  it("returns empty array for gemini (no builtin models yet)", () => {
    const models = getBuiltinProviderModels("gemini");
    assert.equal(models.length, 0);
  });
});

describe("findProviderModelLabel", () => {
  it("finds label for a known claude model", () => {
    const label = findProviderModelLabel("claude", "claude-opus-4-6");
    assert.equal(label, "Opus 4.6");
  });

  it("formats a readable label for an unknown claude model id", () => {
    const label = findProviderModelLabel("claude", "claude-opus-4-8");
    assert.equal(label, "Opus 4.8");
  });

  it("finds label for a known codex model", () => {
    const label = findProviderModelLabel("codex", "gpt-5.4");
    assert.equal(label, "GPT-5.4");
  });

  it("formats a readable label for an unknown codex model id", () => {
    const label = findProviderModelLabel("codex", "gpt-5.5");
    assert.equal(label, "GPT-5.5");
  });

  it("returns null for unknown model ID", () => {
    const label = findProviderModelLabel("claude", "claude-nonexistent-99");
    assert.equal(label, null);
  });

  it("returns null for provider with no models", () => {
    const label = findProviderModelLabel("gemini", "gemini-pro");
    assert.equal(label, null);
  });
});

describe("getDefaultProviderCapabilities", () => {
  it("every provider defines composer hints", () => {
    for (const provider of ["claude", "codex", "gemini"]) {
      const caps = getDefaultProviderCapabilities(provider);
      assert.equal(typeof caps.composerHints?.helpText, "string");
      assert.ok(caps.composerHints.helpText.length > 0);
    }
  });
});
