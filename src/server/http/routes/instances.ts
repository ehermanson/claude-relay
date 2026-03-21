import type { Route, HttpDeps } from "../types.js";
import { readJsonBody } from "../body.js";
import { requireAuth } from "../guards.js";
import { sendJson } from "../respond.js";
import type { ProviderKind, ProviderModelOptions } from "../../../core/types.js";

export function createInstanceRoutes(deps: HttpDeps): Route[] {
  const { instanceManager } = deps;

  return [
    {
      method: "GET",
      pattern: /^\/api\/instances$/,
      handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }
        sendJson(ctx.res, 200, instanceManager.listInstances());
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/instances$/,
      async handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }
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
          }>(ctx.req);
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
          sendJson(ctx.res, 201, info);
        } catch (err) {
          sendJson(ctx.res, 400, {
            error: err instanceof Error ? err.message : "Failed to create instance",
          });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/instances\/([a-f0-9-]+)\/summary$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const summary = instanceManager.getChatSummary(match[1]);
        if (!summary) {
          sendJson(ctx.res, 404, { error: "Instance not found" });
          return;
        }
        sendJson(ctx.res, 200, summary);
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/instances\/([a-f0-9-]+)$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const removed = instanceManager.removeInstance(match[1]);
        if (removed) {
          sendJson(ctx.res, 200, { success: true });
          return;
        }
        sendJson(ctx.res, 404, { error: "Instance not found" });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/instances\/([a-f0-9-]+)\/merge$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        try {
          const { targetBranch } = instanceManager.mergeInstance(match[1]);
          sendJson(ctx.res, 200, { success: true, targetBranch });
        } catch (err) {
          sendJson(ctx.res, 400, {
            error: err instanceof Error ? err.message : "Failed to merge",
          });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/instances\/([a-f0-9-]+)\/history$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        try {
          sendJson(ctx.res, 200, instanceManager.getHistory(match[1]));
        } catch {
          sendJson(ctx.res, 404, { error: "Instance not found" });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/instances\/([a-f0-9-]+)\/diff$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const diff = instanceManager.getInstanceDiff(
          match[1],
          ctx.parsedUrl.searchParams.get("path") || undefined,
        );
        if (diff === null) {
          sendJson(ctx.res, 404, { error: "Instance not found or not a git repo" });
          return;
        }
        sendJson(ctx.res, 200, { diff });
      },
    },
  ];
}
