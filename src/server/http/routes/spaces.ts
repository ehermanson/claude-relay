import type { Route, HttpDeps } from "../types.js";
import { readJsonBody } from "../body.js";
import { requireAuth } from "../guards.js";
import { sendJson } from "../respond.js";

export function createSpaceRoutes(deps: HttpDeps): Route[] {
  const { instanceManager } = deps;

  return [
    {
      method: "GET",
      pattern: /^\/api\/projects\/([a-f0-9-]+)\/spaces$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const project = instanceManager.projectManager.getProject(match[1]);
        if (!project) {
          sendJson(ctx.res, 404, { error: "Project not found" });
          return;
        }
        sendJson(ctx.res, 200, instanceManager.getSpaceManager().listSpaces(project.directory));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/projects\/([a-f0-9-]+)\/spaces$/,
      async handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const project = instanceManager.projectManager.getProject(match[1]);
        if (!project) {
          sendJson(ctx.res, 404, { error: "Project not found" });
          return;
        }
        try {
          const body = await readJsonBody<{ name?: string; baseBranch?: string }>(ctx.req);
          const space = instanceManager.getSpaceManager().createSpace(project.directory, {
            name: body.name,
            baseBranch: body.baseBranch,
          });
          sendJson(ctx.res, 201, space);
        } catch (err) {
          sendJson(ctx.res, 400, {
            error: err instanceof Error ? err.message : "Failed to create space",
          });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/spaces\/([a-f0-9-]+)$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const space = instanceManager.getSpaceManager().getSpace(match[1]);
        if (!space) {
          sendJson(ctx.res, 404, { error: "Space not found" });
          return;
        }
        sendJson(ctx.res, 200, space);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/spaces\/([a-f0-9-]+)\/complete$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        try {
          const result = instanceManager.getSpaceManager().completeSpace(match[1]);
          sendJson(ctx.res, 200, { success: true, ...result });
        } catch (err) {
          sendJson(ctx.res, 400, {
            error: err instanceof Error ? err.message : "Failed to complete space",
          });
        }
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/spaces\/([a-f0-9-]+)$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        try {
          instanceManager.getSpaceManager().deleteSpace(match[1]);
          sendJson(ctx.res, 200, { success: true });
        } catch (err) {
          sendJson(ctx.res, 400, {
            error: err instanceof Error ? err.message : "Failed to delete space",
          });
        }
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/spaces\/([a-f0-9-]+)\/push$/,
      async handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        try {
          const body = await readJsonBody<{ createPR?: boolean }>(ctx.req);
          const result = await instanceManager
            .getSpaceManager()
            .pushSpace(match[1], { createPR: body.createPR });
          sendJson(ctx.res, result.pushed ? 200 : 400, result);
        } catch (err) {
          sendJson(ctx.res, 400, {
            error: err instanceof Error ? err.message : "Failed to push space",
          });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/spaces\/([a-f0-9-]+)\/diff$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const diff = instanceManager.getSpaceManager().getSpaceDiff(match[1]);
        if (diff == null) {
          sendJson(ctx.res, 404, { error: "Space not found" });
          return;
        }
        sendJson(ctx.res, 200, { diff });
      },
    },
  ];
}
