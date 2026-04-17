import type { Hono } from "hono";
import type { ProviderModelsResponse } from "#core/types.js";
import { mergeCapabilities, resolveProviderDefaultModelOption } from "#core/provider-catalog.js";
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
}
