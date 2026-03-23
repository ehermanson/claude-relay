import fs from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import { getParsedUrl, readJsonBody, requireAuth } from "../hono-utils.js";
import type { ContextVariables, HttpDeps } from "../types.js";

export function registerNativeOpenRoutes(
  app: Hono<{ Variables: ContextVariables }>,
  deps: HttpDeps,
): void {
  app.get("/api/open-targets", async (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;

    const targetPath = (getParsedUrl(c).searchParams.get("path") || "").trim();
    if (!targetPath) {
      return c.json({ error: "Missing path" }, 400);
    }
    if (!path.isAbsolute(targetPath)) {
      return c.json({ error: "Path must be absolute" }, 400);
    }
    if (!fs.existsSync(targetPath)) {
      return c.json({ error: "Path not found" }, 404);
    }

    try {
      return c.json(await deps.getOpenTargets(targetPath));
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to load open targets" },
        500,
      );
    }
  });

  app.post("/api/open", async (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;

    const body = await readJsonBody<{
      path?: string;
      line?: number;
      column?: number;
      targetId?: string;
      rememberForProject?: boolean;
    }>(c);
    const targetPath = typeof body.path === "string" ? body.path.trim() : "";
    if (!targetPath) {
      return c.json({ error: "Missing path" }, 400);
    }
    if (!path.isAbsolute(targetPath)) {
      return c.json({ error: "Path must be absolute" }, 400);
    }
    if (!fs.existsSync(targetPath)) {
      return c.json({ error: "Path not found" }, 404);
    }

    try {
      await deps.openNativePath({
        path: targetPath,
        line: typeof body.line === "number" ? body.line : undefined,
        column: typeof body.column === "number" ? body.column : undefined,
        targetId: typeof body.targetId === "string" ? body.targetId : undefined,
        rememberForProject: body.rememberForProject === true,
      });
      return c.json({ success: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to open path" }, 500);
    }
  });
}
