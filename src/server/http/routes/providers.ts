import type { Hono } from "hono";
import { getParsedUrl, requireAuth } from "../hono-utils.js";
import type { ContextVariables, HttpDeps } from "../types.js";

export function registerProviderRoutes(
  app: Hono<{ Variables: ContextVariables }>,
  deps: HttpDeps,
): void {
  app.get("/api/provider-models", async (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const providerParam = getParsedUrl(c).searchParams.get("provider");
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
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    return c.json({ providers: deps.getAvailableProviders() });
  });
}
