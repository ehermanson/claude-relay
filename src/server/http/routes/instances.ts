import type { Hono } from "hono";
import type { ProviderKind, ProviderModelOptions } from "../../../core/types.js";
import { getParsedUrl, readJsonBody, requireAuth } from "../hono-utils.js";
import type { ContextVariables, HttpDeps } from "../types.js";

export function registerInstanceRoutes(
  app: Hono<{ Variables: ContextVariables }>,
  deps: HttpDeps,
): void {
  const { instanceManager } = deps;

  app.get("/api/instances", (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    return c.json(instanceManager.listInstances());
  });

  app.post("/api/instances", async (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    try {
      const body = await readJsonBody<{
        provider?: ProviderKind;
        name?: string;
        workingDirectory?: string;
        dangerouslySkipPermissions?: boolean;
        resumeSessionId?: string;
        model?: string;
        spaceId?: string;
        modelOptions?: ProviderModelOptions;
      }>(c);
      const info = instanceManager.createInstance({
        provider: body.provider,
        name: body.name,
        workingDirectory: body.workingDirectory,
        dangerouslySkipPermissions: body.dangerouslySkipPermissions,
        resumeSessionId: body.resumeSessionId,
        model: body.model,
        spaceId: body.spaceId,
        modelOptions: body.modelOptions,
      });
      return c.json(info, 201);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to create instance" },
        400,
      );
    }
  });

  app.get("/api/instances/:id/summary", (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const summary = instanceManager.getChatSummary(c.req.param("id"));
    if (!summary) {
      return c.json({ error: "Instance not found" }, 404);
    }
    return c.json(summary);
  });

  app.delete("/api/instances/:id", (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const removed = instanceManager.removeInstance(c.req.param("id"));
    if (removed) {
      return c.json({ success: true });
    }
    return c.json({ error: "Instance not found" }, 404);
  });

  app.post("/api/instances/:id/merge", (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    try {
      const { targetBranch } = instanceManager.mergeInstance(c.req.param("id"));
      return c.json({ success: true, targetBranch });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to merge" }, 400);
    }
  });

  app.get("/api/instances/:id/history", (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    try {
      return c.json(instanceManager.getHistory(c.req.param("id")));
    } catch {
      return c.json({ error: "Instance not found" }, 404);
    }
  });

  app.get("/api/instances/:id/diff", (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const parsedUrl = getParsedUrl(c);
    const diff = instanceManager.getInstanceDiff(
      c.req.param("id"),
      parsedUrl.searchParams.get("path") || undefined,
    );
    if (diff === null) {
      return c.json({ error: "Instance not found or not a git repo" }, 404);
    }
    return c.json({ diff });
  });
}
