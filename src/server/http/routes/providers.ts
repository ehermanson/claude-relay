import type { Hono } from "hono";
import type { AppEnv, HttpDeps } from "../types.js";

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
      const models = await deps.getProviderModels(provider);
      return c.json({
        provider,
        models,
        capabilities: deps.getProviderCapabilities(provider),
      });
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
