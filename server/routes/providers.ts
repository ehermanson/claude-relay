import type { Hono } from "hono";
import type { ProviderKind, ProviderModelsResponse } from "#core/types.js";
import { mergeCapabilities, resolveProviderDefaultModelOption } from "#core/provider-catalog.js";
import { refreshProviderVersionAdvisories, runProviderUpdate } from "#core/provider-registry.js";
import type { AppEnv, HttpDeps } from "#server/route-types.js";

export function registerProviderRoutes(app: Hono<AppEnv>, deps: HttpDeps): void {
  app.get("/api/provider-models", async (c) => {
    const providerParam = c.req.query("provider");
    const provider = deps
      .getAvailableProviders()
      .find((entry) => entry.provider === providerParam)?.provider;
    if (!provider) {
      return c.json({ error: "Invalid provider" }, 400);
    }
    try {
      const capabilities = deps.getProviderCapabilities(provider);
      const models = (await deps.getProviderModels(provider)).map((model) => ({
        ...model,
        resolvedCapabilities: mergeCapabilities(capabilities, model.capabilities),
      }));
      const defaultModel = resolveProviderDefaultModelOption(provider, models);
      const response: ProviderModelsResponse = {
        provider,
        models,
        capabilities,
        defaultModel,
      };
      return c.json(response);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to load provider models" },
        500,
      );
    }
  });

  app.get("/api/providers", (c) => {
    return c.json({ providers: deps.getAvailableProviders() });
  });

  // Force-refresh provider version advisories, bypassing the 1h npm registry
  // cache. Used by the "Re-check" button in settings. Optional `provider`
  // query param scopes the refresh to one provider; absent = refresh all.
  app.post("/api/providers/recheck-version", async (c) => {
    const providerParam = c.req.query("provider");
    const known = deps.getAvailableProviders().map((p) => p.provider);
    if (providerParam && !known.includes(providerParam as ProviderKind)) {
      return c.json({ error: "Invalid provider" }, 400);
    }
    try {
      await refreshProviderVersionAdvisories({
        provider: providerParam ? (providerParam as ProviderKind) : undefined,
        force: true,
      });
      return c.json({ providers: deps.getAvailableProviders() });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to recheck provider version" },
        500,
      );
    }
  });

  // Run the provider's update command server-side (e.g. `brew upgrade codex`).
  // The command is derived from the cached version advisory — the client only
  // names the provider. Responds after the update finishes and the advisory
  // has been re-probed; concurrent requests for the same provider share one
  // run. Used by the "Update now" button in settings.
  app.post("/api/providers/update", async (c) => {
    const providerParam = c.req.query("provider");
    const known = deps.getAvailableProviders().map((p) => p.provider);
    if (!providerParam || !known.includes(providerParam as ProviderKind)) {
      return c.json({ error: "Invalid provider" }, 400);
    }
    const result = await runProviderUpdate(providerParam as ProviderKind);
    if (result.status === "no_update") {
      return c.json({ error: "No automatic update is available for this provider" }, 409);
    }
    if (result.status === "failed") {
      const tail = result.output.slice(-500).trim();
      return c.json(
        { error: tail ? `Update failed: ${tail}` : "Update failed", output: result.output },
        500,
      );
    }
    return c.json({ output: result.output, providers: deps.getAvailableProviders() });
  });
}
