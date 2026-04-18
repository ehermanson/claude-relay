import type { Hono } from "hono";
import type { AppEnv, HttpDeps } from "#server/route-types.js";

export function registerSystemUpdateRoutes(app: Hono<AppEnv>, deps: HttpDeps): void {
  const { updateManager } = deps;

  app.get("/api/system/update", (c) => {
    return c.json(updateManager.getSnapshot());
  });

  app.post("/api/system/update/check", async (c) => {
    const force = c.req.query("force") === "1";
    return c.json(await updateManager.checkForUpdates({ force }));
  });

  app.post("/api/system/update/install", async (c) => {
    const result = await updateManager.installUpdate();
    if (!result.ok) {
      return c.json(result, 400);
    }
    return c.json(result);
  });
}
