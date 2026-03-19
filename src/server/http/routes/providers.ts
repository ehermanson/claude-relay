import type { Route, HttpDeps } from "../types.js";
import { requireAuth } from "../guards.js";
import { sendJson } from "../respond.js";

export function createProviderRoutes(deps: HttpDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/api\/provider-models$/,
      async handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }
        const providerParam = ctx.parsedUrl.searchParams.get("provider");
        const provider = deps
          .getAvailableProviders()
          .find((entry) => entry.provider === providerParam)?.provider;
        if (!provider) {
          sendJson(ctx.res, 400, { error: "Invalid provider" });
          return;
        }
        try {
          const models = await deps.getProviderModels(provider);
          sendJson(ctx.res, 200, {
            provider,
            models,
            capabilities: deps.getProviderCapabilities(provider),
          });
        } catch (err) {
          sendJson(ctx.res, 500, {
            error: err instanceof Error ? err.message : "Failed to load provider models",
          });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/providers$/,
      handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }
        sendJson(ctx.res, 200, { providers: deps.getAvailableProviders() });
      },
    },
  ];
}
