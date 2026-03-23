import type { Hono } from "hono";
import { getPrimaryRemote } from "../../../core/git.js";
import { readJsonBody, requireAuth } from "../hono-utils.js";
import type { ContextVariables, HttpDeps } from "../types.js";

export function registerSpaceRoutes(
  app: Hono<{ Variables: ContextVariables }>,
  deps: HttpDeps,
): void {
  const { instanceManager } = deps;

  app.get("/api/projects/:id/spaces", (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    return c.json(instanceManager.getSpaceManager().listSpaces(project.directory));
  });

  app.post("/api/projects/:id/spaces", async (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    try {
      const body = await readJsonBody<{ name?: string; baseBranch?: string }>(c);
      let effectiveBranch = body.baseBranch;
      if (!effectiveBranch && project.defaultSpaceBranch) {
        effectiveBranch = project.defaultSpaceBranch;
      }
      if (effectiveBranch && project.spaceBranchSource === "remote" && project.repoRoot) {
        const remote = getPrimaryRemote(project.repoRoot);
        if (!effectiveBranch.includes("/")) {
          effectiveBranch = `${remote}/${effectiveBranch}`;
        }
      }
      const space = instanceManager.getSpaceManager().createSpace(project.directory, {
        name: body.name,
        baseBranch: effectiveBranch,
      });
      return c.json(space, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to create space" }, 400);
    }
  });

  app.get("/api/spaces/:id", (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const space = instanceManager.getSpaceManager().getSpace(c.req.param("id"));
    if (!space) {
      return c.json({ error: "Space not found" }, 404);
    }
    return c.json(space);
  });

  app.post("/api/spaces/:id/complete", (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    try {
      const result = instanceManager.getSpaceManager().completeSpace(c.req.param("id"));
      return c.json({ success: true, ...result });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to complete space" },
        400,
      );
    }
  });

  app.delete("/api/spaces/:id", (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    try {
      instanceManager.getSpaceManager().deleteSpace(c.req.param("id"));
      return c.json({ success: true });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to delete space" }, 400);
    }
  });

  app.post("/api/spaces/:id/push", async (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    try {
      const body = await readJsonBody<{ createPR?: boolean }>(c);
      const result = await instanceManager
        .getSpaceManager()
        .pushSpace(c.req.param("id"), { createPR: body.createPR });
      return c.json(result, result.pushed ? 200 : 400);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to push space" }, 400);
    }
  });

  app.get("/api/spaces/:id/diff", (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const diff = instanceManager.getSpaceManager().getSpaceDiff(c.req.param("id"));
    if (diff == null) {
      return c.json({ error: "Space not found" }, 404);
    }
    return c.json({ diff });
  });
}
