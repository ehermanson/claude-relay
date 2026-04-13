import type { Hono } from "hono";
import type { AppEnv, HttpDeps } from "#server/route-types.js";

export function registerSearchRoutes(app: Hono<AppEnv>, deps: HttpDeps): void {
  const { instanceManager } = deps;

  app.get("/api/search", (c) => {
    const q = c.req.query("q")?.trim();
    if (!q) {
      return c.json({ results: [] });
    }

    const projectId = c.req.query("projectId") || undefined;
    const rawLimit = Number(c.req.query("limit"));
    const limit = Math.max(
      1,
      Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 20, 50),
    );

    const results = instanceManager.sessionDb.search(q, { projectId, limit });
    return c.json({ results });
  });

  app.post("/api/search/rebuild", (c) => {
    instanceManager.sessionDb.rebuildSearchIndex();
    return c.json({ success: true });
  });
}
