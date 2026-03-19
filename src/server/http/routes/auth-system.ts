import fs from "node:fs";
import path from "node:path";
import type { Route, HttpDeps } from "../types.js";
import { readJsonBody } from "../body.js";
import { requireAuth } from "../guards.js";
import { redirect, sendJson } from "../respond.js";

export function createAuthSystemRoutes(deps: HttpDeps): Route[] {
  const { auth, config, instanceManager, packageVersion, startedAt } = deps;

  return [
    {
      method: "GET",
      pattern: /^\/health$/,
      handler(ctx) {
        const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
        sendJson(ctx.res, 200, {
          status: "ok",
          uptime: uptimeSeconds,
          instances: instanceManager.listInstances().length,
          version: packageVersion,
        });
      },
    },
    {
      method: "POST",
      pattern: /^\/auth$/,
      async handler(ctx) {
        const forwarded = ctx.req.headers["x-forwarded-for"];
        const rawIp =
          (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : null) ||
          ctx.req.socket.remoteAddress ||
          "unknown";
        const ip = rawIp.startsWith("::ffff:") ? rawIp.slice(7) : rawIp;

        if (!auth.checkRateLimit(ip)) {
          config.logger.warn(`Rate limit exceeded for ${ip}`);
          sendJson(ctx.res, 429, { error: "Too many attempts. Try again later." });
          return;
        }

        let body: { password?: string };
        try {
          body = await readJsonBody<{ password?: string }>(ctx.req);
        } catch {
          sendJson(ctx.res, 400, { error: "Invalid JSON" });
          return;
        }

        if (body.password === config.password) {
          const session = auth.createSession();
          sendJson(
            ctx.res,
            200,
            { success: true },
            { "Set-Cookie": auth.serializeSessionCookie(session.id) },
          );
          return;
        }

        sendJson(ctx.res, 401, { error: "Wrong password" });
      },
    },
    {
      method: "GET",
      pattern: /^\/logout$/,
      handler(ctx) {
        if (ctx.session) {
          auth.deleteSession(ctx.session.id);
        }
        redirect(ctx.res, "/login", { "Set-Cookie": auth.clearSessionCookie() });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/stats$/,
      handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }

        const allInstances = instanceManager.listInstances();
        const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);

        let active = 0;
        let idle = 0;
        let external = 0;
        let stopped = 0;
        let currentTokens = 0;

        for (const inst of allInstances) {
          if (inst.status === "processing") active++;
          else if (inst.status === "idle") idle++;
          else if (inst.status === "stopped") stopped++;
          if (inst.external) external++;
          if (inst.stats) {
            currentTokens += inst.stats.inputTokens + inst.stats.outputTokens;
          }
        }

        const allTime = instanceManager.getGlobalStats();
        sendJson(ctx.res, 200, {
          instances: {
            total: allInstances.length,
            active,
            idle,
            stopped,
            external,
          },
          currentSessions: {
            tokens: currentTokens,
          },
          allTime: {
            sessionCount: allTime.sessionCount,
            inputTokens: allTime.inputTokens,
            outputTokens: allTime.outputTokens,
            cacheCreationTokens: allTime.cacheCreationTokens,
            cacheReadTokens: allTime.cacheReadTokens,
            tokens: allTime.inputTokens + allTime.outputTokens,
          },
          uptime: uptimeSeconds,
          connections: deps.getConnectionCount ? deps.getConnectionCount() : 0,
        });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/beads-projects$/,
      handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }
        sendJson(
          ctx.res,
          200,
          instanceManager
            .getKnownDirectories()
            .filter((entry) => fs.existsSync(path.join(entry.path, ".beads"))),
        );
      },
    },
  ];
}
