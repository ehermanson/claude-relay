/**
 * HTTP Request Handler for Claude Relay
 *
 * Factory function that creates the HTTP request handler.
 * Separated from server creation so consumers can compose their own server.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { AuthManager } from "./auth.js";
import type { InstanceManager } from "./instance-manager.js";
import type { RelayConfig } from "./config.js";

const publicDir = path.join(import.meta.dirname, "..", "public");
const indexHtmlPath = path.join(publicDir, "index.html");
const chatHtmlPath = path.join(publicDir, "chat.html");

// Read version from package.json at startup
const packageJsonPath = path.join(import.meta.dirname, "..", "package.json");
const packageVersion: string = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")).version;

function readHtmlFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

function sendHtml(
  res: http.ServerResponse,
  statusCode: number,
  html: string
): void {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
  });
  res.end(html);
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  data: unknown,
  headers: Record<string, string> = {}
): void {
  const json = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
    ...headers,
  });
  res.end(json);
}

function redirect(
  res: http.ServerResponse,
  location: string,
  headers: Record<string, string> = {}
): void {
  res.writeHead(302, { Location: location, ...headers });
  res.end();
}

function parseJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    const MAX_BODY = 1024 * 10; // 10KB limit

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// Regex patterns for URL matching
const chatRoutePattern = /^\/chat(?:\/([a-f0-9-]+))?$/;
const instancesRoutePattern = /^\/api\/instances$/;
const instanceByIdPattern = /^\/api\/instances\/([a-f0-9-]+)$/;
const instanceHistoryPattern = /^\/api\/instances\/([a-f0-9-]+)\/history$/;

/**
 * Create the HTTP request handler.
 */
export function createRequestHandler(
  config: RelayConfig,
  auth: AuthManager,
  instanceManager: InstanceManager,
  getConnectionCount?: () => number
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const log = config.logger;
  const startedAt = Date.now();

  return async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const { method } = req;
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;
    const cookieHeader = req.headers.cookie;
    const session = auth.getSessionFromCookies(cookieHeader);
    const isAuthenticated = session !== null;

    try {
      // GET /health — unauthenticated, for monitoring/health checks
      if (method === "GET" && pathname === "/health") {
        const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
        sendJson(res, 200, {
          status: "ok",
          uptime: uptimeSeconds,
          instances: instanceManager.listInstances().length,
          version: packageVersion,
        });
        return;
      }

      // GET / or GET /login
      if (method === "GET" && (pathname === "/" || pathname === "/login")) {
        if (isAuthenticated) {
          redirect(res, "/chat");
        } else if (config.serveUI) {
          const html = readHtmlFile(indexHtmlPath);
          sendHtml(res, 200, html);
        } else {
          sendJson(res, 200, { status: "ok", authenticated: false });
        }
        return;
      }

      // POST /auth
      if (method === "POST" && pathname === "/auth") {
        const ip = req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "unknown";

        if (!auth.checkRateLimit(ip)) {
          log.warn(`Rate limit exceeded for ${ip}`);
          sendJson(res, 429, { error: "Too many attempts. Try again later." });
          return;
        }

        const body = (await parseJsonBody(req)) as { password?: string };

        if (body.password === config.password) {
          const newSession = auth.createSession();
          const cookie = auth.serializeSessionCookie(newSession.id);
          sendJson(res, 200, { success: true }, { "Set-Cookie": cookie });
        } else {
          sendJson(res, 401, { error: "Wrong password" });
        }
        return;
      }

      // GET /chat or GET /chat/:id
      const chatMatch = pathname.match(chatRoutePattern);
      if (method === "GET" && chatMatch) {
        if (!isAuthenticated) {
          redirect(res, "/login");
        } else if (config.serveUI) {
          const html = readHtmlFile(chatHtmlPath);
          sendHtml(res, 200, html);
        } else {
          sendJson(res, 200, { status: "ok", authenticated: true });
        }
        return;
      }

      // GET /logout
      if (method === "GET" && pathname === "/logout") {
        if (session) {
          auth.deleteSession(session.id);
        }
        const cookie = auth.clearSessionCookie();
        redirect(res, "/login", { "Set-Cookie": cookie });
        return;
      }

      // =====================================================================
      // REST API routes (all require authentication)
      // =====================================================================

      // GET /api/instances
      if (method === "GET" && instancesRoutePattern.test(pathname)) {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        sendJson(res, 200, instanceManager.listInstances());
        return;
      }

      // POST /api/instances
      if (method === "POST" && instancesRoutePattern.test(pathname)) {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        try {
          const body = (await parseJsonBody(req)) as {
            name?: string;
            workingDirectory?: string;
            dangerouslySkipPermissions?: boolean;
          };
          const info = instanceManager.createInstance({
            name: body.name,
            workingDirectory: body.workingDirectory,
            dangerouslySkipPermissions: body.dangerouslySkipPermissions,
          });
          sendJson(res, 201, info);
        } catch (err) {
          sendJson(res, 400, {
            error: err instanceof Error ? err.message : "Failed to create instance",
          });
        }
        return;
      }

      // DELETE /api/instances/:id
      const deleteMatch = pathname.match(instanceByIdPattern);
      if (method === "DELETE" && deleteMatch) {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        const id = deleteMatch[1];
        const removed = instanceManager.removeInstance(id);
        if (removed) {
          sendJson(res, 200, { success: true });
        } else {
          sendJson(res, 404, { error: "Instance not found" });
        }
        return;
      }

      // GET /api/instances/:id/history
      const historyMatch = pathname.match(instanceHistoryPattern);
      if (method === "GET" && historyMatch) {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        const id = historyMatch[1];
        try {
          const history = instanceManager.getHistory(id);
          sendJson(res, 200, history);
        } catch {
          sendJson(res, 404, { error: "Instance not found" });
        }
        return;
      }

      // GET /api/stats
      if (method === "GET" && pathname === "/api/stats") {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        const allInstances = instanceManager.listInstances();
        const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);

        let active = 0;
        let idle = 0;
        let external = 0;
        let stopped = 0;

        for (const inst of allInstances) {
          if (inst.status === "processing") active++;
          else if (inst.status === "idle") idle++;
          else if (inst.status === "stopped") stopped++;
          if (inst.external) external++;
        }

        sendJson(res, 200, {
          instances: {
            total: allInstances.length,
            active,
            idle,
            external,
            stopped,
          },
          uptime: uptimeSeconds,
          connections: getConnectionCount ? getConnectionCount() : 0,
        });
        return;
      }

      // 404
      sendHtml(res, 404, "<h1>404 Not Found</h1>");
    } catch (error) {
      log.error("Request error:", error);
      sendHtml(res, 500, "<h1>500 Internal Server Error</h1>");
    }
  };
}
