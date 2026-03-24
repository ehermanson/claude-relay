import fs from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import type { AppEnv, HttpDeps } from "../types.js";
import { getSession, readJsonBody } from "../hono-utils.js";

export function registerPublicSystemRoutes(app: Hono<AppEnv>, deps: HttpDeps): void {
  const { auth, config, instanceManager, packageVersion, startedAt } = deps;

  app.get("/health", (c) => {
    const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
    return c.json({
      status: "ok",
      uptime: uptimeSeconds,
      instances: instanceManager.listInstances().length,
      version: packageVersion,
    });
  });

  app.post("/auth", async (c) => {
    const forwarded = c.req.header("x-forwarded-for");
    const rawIp =
      (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : null) ||
      c.env.incoming.socket.remoteAddress ||
      "unknown";
    const ip = rawIp.startsWith("::ffff:") ? rawIp.slice(7) : rawIp;

    if (!auth.checkRateLimit(ip)) {
      config.logger.warn(`Rate limit exceeded for ${ip}`);
      return c.json({ error: "Too many attempts. Try again later." }, 429);
    }

    let body: { password?: string };
    try {
      body = await readJsonBody<{ password?: string }>(c);
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    if (body.password === config.password) {
      const session = auth.createSession();
      c.header("Set-Cookie", auth.serializeSessionCookie(session.id));
      return c.json({ success: true }, 200);
    }

    return c.json({ error: "Wrong password" }, 401);
  });

  app.get("/logout", (c) => {
    const session = getSession(c);
    if (session) {
      auth.deleteSession(session.id);
    }
    c.header("Set-Cookie", auth.clearSessionCookie());
    return c.redirect("/login", 302);
  });
}

export function registerProtectedSystemRoutes(api: Hono<AppEnv>, deps: HttpDeps): void {
  const { instanceManager, startedAt } = deps;

  api.get("/api/stats", (c) => {
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
    return c.json({
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
  });

  api.get("/api/beads-projects", (c) => {
    return c.json(
      instanceManager
        .getKnownDirectories()
        .filter((entry) => fs.existsSync(path.join(entry.path, ".beads"))),
    );
  });
}
