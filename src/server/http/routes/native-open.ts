import fs from "node:fs";
import path from "node:path";
import type { Route, HttpDeps } from "../types.js";
import { readJsonBody } from "../body.js";
import { requireAuth } from "../guards.js";
import { sendJson } from "../respond.js";

export function createNativeOpenRoutes(deps: HttpDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/api\/open-targets$/,
      async handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }

        const targetPath = (ctx.parsedUrl.searchParams.get("path") || "").trim();
        if (!targetPath) {
          sendJson(ctx.res, 400, { error: "Missing path" });
          return;
        }
        if (!path.isAbsolute(targetPath)) {
          sendJson(ctx.res, 400, { error: "Path must be absolute" });
          return;
        }
        if (!fs.existsSync(targetPath)) {
          sendJson(ctx.res, 404, { error: "Path not found" });
          return;
        }

        try {
          sendJson(ctx.res, 200, await deps.getOpenTargets(targetPath));
        } catch (err) {
          sendJson(ctx.res, 500, {
            error: err instanceof Error ? err.message : "Failed to load open targets",
          });
        }
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/open$/,
      async handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }

        const body = await readJsonBody<{
          path?: string;
          line?: number;
          column?: number;
          targetId?: string;
          rememberForProject?: boolean;
        }>(ctx.req);
        const targetPath = typeof body.path === "string" ? body.path.trim() : "";
        if (!targetPath) {
          sendJson(ctx.res, 400, { error: "Missing path" });
          return;
        }
        if (!path.isAbsolute(targetPath)) {
          sendJson(ctx.res, 400, { error: "Path must be absolute" });
          return;
        }
        if (!fs.existsSync(targetPath)) {
          sendJson(ctx.res, 404, { error: "Path not found" });
          return;
        }

        try {
          await deps.openNativePath({
            path: targetPath,
            line: typeof body.line === "number" ? body.line : undefined,
            column: typeof body.column === "number" ? body.column : undefined,
            targetId: typeof body.targetId === "string" ? body.targetId : undefined,
            rememberForProject: body.rememberForProject === true,
          });
          sendJson(ctx.res, 200, { success: true });
        } catch (err) {
          sendJson(ctx.res, 500, {
            error: err instanceof Error ? err.message : "Failed to open path",
          });
        }
      },
    },
  ];
}
