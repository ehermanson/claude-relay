import type { Hono } from "hono";
import type { AppEnv, HttpDeps } from "#server/route-types.js";

export function registerSearchRoutes(app: Hono<AppEnv>, deps: HttpDeps): void {
  const { instanceManager } = deps;

  app.get("/api/search", (c) => {
    const q = c.req.query("q") ?? "";
    const projectId = c.req.query("projectId") || undefined;
    const boostProjectId = c.req.query("boostProjectId") || undefined;
    const rawLimit = Number(c.req.query("limit"));
    const limit = Math.max(
      1,
      Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 20, 50),
    );

    // Empty query → recent chats, so the search dialog doubles as a chat switcher
    const results = q.trim()
      ? instanceManager.sessionDb.search(q, { projectId, boostProjectId, limit })
      : instanceManager.sessionDb.recentChats({ projectId, limit });
    return c.json({ results });
  });

  app.post("/api/search/rebuild", (c) => {
    instanceManager.sessionDb.rebuildSearchIndex();
    return c.json({ success: true });
  });
}
