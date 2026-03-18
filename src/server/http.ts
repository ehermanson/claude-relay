/**
 * HTTP Request Handler for Relay
 *
 * Factory function that creates the HTTP request handler.
 * Separated from server creation so consumers can compose their own server.
 */

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import type { AuthManager } from "./auth.js";
import type { InstanceManager } from "../core/instance-manager.js";
import type { RelayConfig } from "./config.js";
import type {
  NativeOpenRequest,
  NativeOpenTargetsResponse,
  ProviderCapabilities,
  ProviderDescriptor,
  ProviderKind,
  ProviderModelOption,
} from "../core/types.js";
import { ProjectOpener } from "./project-opener.js";

const uiDistDir = path.join(import.meta.dirname, "..", "..", "ui", "dist");
const indexHtmlPath = path.join(uiDistDir, "index.html");

// Read version from package.json at startup
const packageJsonPath = path.join(import.meta.dirname, "..", "..", "package.json");
const packageVersion: string = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")).version;

// MIME type map for static files
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
};

function sendFile(res: http.ServerResponse, filePath: string, isAsset: boolean): void {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  try {
    const data = fs.readFileSync(filePath);
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length": String(data.length),
    };

    // Hashed assets from Vite are immutable
    if (isAsset) {
      headers["Cache-Control"] = "public, max-age=31536000, immutable";
    } else {
      headers["Cache-Control"] = "no-cache";
    }

    res.writeHead(200, headers);
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

function sendHtml(res: http.ServerResponse, statusCode: number, html: string): void {
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
  headers: Record<string, string> = {},
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
  headers: Record<string, string> = {},
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

/** Serve the SPA index.html (React Router handles routing) */
function serveIndex(res: http.ServerResponse): void {
  try {
    const html = fs.readFileSync(indexHtmlPath, "utf-8");
    sendHtml(res, 200, html);
  } catch {
    sendHtml(res, 500, "<h1>UI not built. Run: npm run build:ui</h1>");
  }
}

// Regex patterns for URL matching
const instancesRoutePattern = /^\/api\/instances$/;
const instanceByIdPattern = /^\/api\/instances\/([a-f0-9-]+)$/;
const instanceHistoryPattern = /^\/api\/instances\/([a-f0-9-]+)\/history$/;
const instanceMergePattern = /^\/api\/instances\/([a-f0-9-]+)\/merge$/;
const instanceDiffPattern = /^\/api\/instances\/([a-f0-9-]+)\/diff$/;
const projectsRoutePattern = /^\/api\/projects$/;
const projectByIdPattern = /^\/api\/projects\/([a-f0-9-]+)$/;

interface RequestHandlerOverrides {
  getProviderModels?: (provider: ProviderKind) => Promise<ProviderModelOption[]>;
  getProviderCapabilities?: (provider: ProviderKind) => ProviderCapabilities;
  getAvailableProviders?: () => ProviderDescriptor[];
  getOpenTargets?: (targetPath: string) => Promise<NativeOpenTargetsResponse>;
  openNativePath?: (request: NativeOpenRequest) => Promise<void>;
}

/**
 * Create the HTTP request handler.
 */
export function createRequestHandler(
  config: RelayConfig,
  auth: AuthManager,
  instanceManager: InstanceManager,
  getConnectionCount?: () => number,
  overrides: RequestHandlerOverrides = {},
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  const log = config.logger;
  const startedAt = Date.now();
  const projectOpener = new ProjectOpener({
    preferencesFile: path.join(path.dirname(config.dbPath), "project-open-preferences.json"),
  });
  const providerModelCache = new Map<
    ProviderKind,
    { expiresAt: number; pending?: Promise<ProviderModelOption[]>; value?: ProviderModelOption[] }
  >();
  const getProviderModels =
    overrides.getProviderModels ??
    (async (provider: ProviderKind): Promise<ProviderModelOption[]> => {
      const cached = providerModelCache.get(provider);
      const now = Date.now();
      if (cached?.value && cached.expiresAt > now) {
        return cached.value.map((model) => ({ ...model }));
      }
      if (cached?.pending) {
        return cached.pending;
      }

      const pending = instanceManager
        .getProviderModels(provider)
        .then((value) => {
          providerModelCache.set(provider, {
            expiresAt: Date.now() + 60_000,
            value,
          });
          return value.map((model) => ({ ...model }));
        })
        .catch((err) => {
          providerModelCache.delete(provider);
          throw err;
        });

      providerModelCache.set(provider, {
        expiresAt: now + 5_000,
        pending,
      });
      return pending;
    });
  const getProviderCapabilities =
    overrides.getProviderCapabilities ??
    ((provider: ProviderKind): ProviderCapabilities =>
      instanceManager.getProviderCapabilities(provider));
  const getAvailableProviders =
    overrides.getAvailableProviders ?? (() => instanceManager.getAvailableProviders());
  const getOpenTargets =
    overrides.getOpenTargets ?? ((targetPath: string) => projectOpener.listTargets(targetPath));
  const doOpenNativePath =
    overrides.openNativePath ?? ((request: NativeOpenRequest) => projectOpener.open(request));
  const gitRepoCache: {
    expiresAt: number;
    pending?: Promise<string[]>;
    value?: string[];
  } = {
    expiresAt: 0,
  };
  const getGitRepos = async (): Promise<string[]> => {
    const now = Date.now();
    if (gitRepoCache.value && gitRepoCache.expiresAt > now) {
      return [...gitRepoCache.value];
    }
    if (gitRepoCache.pending) {
      const repos = await gitRepoCache.pending;
      return [...repos];
    }

    const pending = (async () => {
      const home = homedir();
      const repos: string[] = [];
      const visited = new Set<string>();
      const MAX_REPOS = 200;
      const MAX_DEPTH = 4;
      const SKIP = new Set([
        "node_modules",
        ".git",
        ".hg",
        ".svn",
        "vendor",
        "venv",
        ".venv",
        "__pycache__",
        "dist",
        "build",
        ".cache",
        ".npm",
        ".cargo",
        ".rustup",
        // macOS
        "Library",
        "Applications",
        ".Trash",
        "Pictures",
        "Music",
        "Movies",
        "Public",
        ".local",
        ".config",
        // Linux
        "snap",
        ".snap",
        ".wine",
        ".steam",
      ]);
      // Seed with common code directories — skip home root to avoid scanning everything
      const queue = [
        "projects",
        "repos",
        "code",
        "src",
        "work",
        "dev",
        "go/src",
        "Developer",
        "Documents",
        "Desktop",
      ].map((segment) => ({ dir: path.join(home, segment), depth: 0 }));

      while (queue.length > 0 && repos.length < MAX_REPOS) {
        const current = queue.shift();
        if (!current || current.depth > MAX_DEPTH) continue;

        let resolved: string;
        try {
          resolved = await fs.promises.realpath(current.dir);
        } catch {
          continue;
        }
        if (visited.has(resolved)) continue;
        visited.add(resolved);

        let entries: fs.Dirent[];
        try {
          entries = await fs.promises.readdir(resolved, { withFileTypes: true });
        } catch {
          continue;
        }

        if (entries.some((entry) => entry.name === ".git")) {
          repos.push(resolved);
          continue;
        }

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith(".")) continue;
          if (SKIP.has(entry.name)) continue;
          queue.push({
            dir: path.join(resolved, entry.name),
            depth: current.depth + 1,
          });
        }
      }

      repos.sort((a, b) => {
        const aName = a.split("/").pop()!.toLowerCase();
        const bName = b.split("/").pop()!.toLowerCase();
        return aName.localeCompare(bName);
      });
      return repos;
    })()
      .then((repos) => {
        gitRepoCache.value = repos;
        gitRepoCache.expiresAt = Date.now() + 30_000;
        delete gitRepoCache.pending;
        return repos;
      })
      .catch((err) => {
        delete gitRepoCache.pending;
        throw err;
      });

    gitRepoCache.pending = pending;
    return [...(await pending)];
  };

  return async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
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

      // POST /auth
      if (method === "POST" && pathname === "/auth") {
        const forwarded = req.headers["x-forwarded-for"];
        const rawIp =
          (typeof forwarded === "string" ? forwarded.split(",")[0].trim() : null) ||
          req.socket.remoteAddress ||
          "unknown";
        // Normalize IPv4-mapped IPv6 addresses (::ffff:127.0.0.1 → 127.0.0.1)
        const ip = rawIp.startsWith("::ffff:") ? rawIp.slice(7) : rawIp;

        if (!auth.checkRateLimit(ip)) {
          log.warn(`Rate limit exceeded for ${ip}`);
          sendJson(res, 429, { error: "Too many attempts. Try again later." });
          return;
        }

        let body: { password?: string };
        try {
          body = (await parseJsonBody(req)) as { password?: string };
        } catch {
          sendJson(res, 400, { error: "Invalid JSON" });
          return;
        }

        if (body.password === config.password) {
          const newSession = auth.createSession();
          const cookie = auth.serializeSessionCookie(newSession.id);
          sendJson(res, 200, { success: true }, { "Set-Cookie": cookie });
        } else {
          sendJson(res, 401, { error: "Wrong password" });
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
            provider?: import("../core/types.js").ProviderKind;
            name?: string;
            workingDirectory?: string;
            dangerouslySkipPermissions?: boolean;
            resumeSessionId?: string;
            model?: string;
          };
          const info = instanceManager.createInstance({
            provider: body.provider,
            name: body.name,
            workingDirectory: body.workingDirectory,
            dangerouslySkipPermissions: body.dangerouslySkipPermissions,
            resumeSessionId: body.resumeSessionId,
            model: body.model,
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

      // POST /api/instances/:id/merge
      const mergeMatch = pathname.match(instanceMergePattern);
      if (method === "POST" && mergeMatch) {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        const id = mergeMatch[1];
        try {
          const { targetBranch } = instanceManager.mergeInstance(id);
          sendJson(res, 200, { success: true, targetBranch });
        } catch (err) {
          sendJson(res, 400, {
            error: err instanceof Error ? err.message : "Failed to merge",
          });
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

      // GET /api/instances/:id/diff?path=<file>
      const diffMatch = pathname.match(instanceDiffPattern);
      if (method === "GET" && diffMatch) {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        const id = diffMatch[1];
        const filePath = parsedUrl.searchParams.get("path") || undefined;
        const diff = instanceManager.getInstanceDiff(id, filePath);
        if (diff === null) {
          sendJson(res, 404, { error: "Instance not found or not a git repo" });
          return;
        }
        sendJson(res, 200, { diff });
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
        let external = 0; // cross-cutting: overlaps with status counts
        let stopped = 0;

        for (const inst of allInstances) {
          if (inst.status === "processing") active++;
          else if (inst.status === "idle") idle++;
          else if (inst.status === "stopped") stopped++;
          if (inst.external) external++;
        }

        // Aggregate token/cost stats from current (live) instances
        let currentTokens = 0;
        for (const inst of allInstances) {
          if (inst.stats) {
            currentTokens += inst.stats.inputTokens + inst.stats.outputTokens;
          }
        }

        // All-time stats from the database (includes archived sessions)
        const allTime = instanceManager.getGlobalStats();

        sendJson(res, 200, {
          instances: {
            total: allInstances.length,
            active,
            idle,
            stopped,
            external, // Note: cross-cutting attribute, not a status. An external instance is also counted in active/idle/stopped.
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
          connections: getConnectionCount ? getConnectionCount() : 0,
        });
        return;
      }

      // GET /api/beads-projects — directories that have beads issue tracker
      if (method === "GET" && pathname === "/api/beads-projects") {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        sendJson(res, 200, instanceManager.getBeadsDirectories());
        return;
      }

      // =====================================================================
      // Project CRUD routes
      // =====================================================================

      // GET /api/projects — list all registered projects
      if (method === "GET" && projectsRoutePattern.test(pathname)) {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        sendJson(res, 200, { projects: instanceManager.projectManager.listProjects() });
        return;
      }

      // POST /api/projects — register a new project
      if (method === "POST" && projectsRoutePattern.test(pathname)) {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        try {
          const body = (await parseJsonBody(req)) as {
            directory?: string;
            name?: string;
            targetBranch?: string;
          };
          if (!body.directory || typeof body.directory !== "string") {
            sendJson(res, 400, { error: "Missing directory" });
            return;
          }
          const project = instanceManager.projectManager.addProject(body.directory, {
            name: body.name,
            targetBranch: body.targetBranch,
          });
          // Scan for existing sessions in this project's directory then notify clients
          instanceManager.rescanAll();
          sendJson(res, 201, project);
        } catch (err) {
          sendJson(res, 400, {
            error: err instanceof Error ? err.message : "Failed to register project",
          });
        }
        return;
      }

      // GET/PATCH/DELETE /api/projects/:id
      const projectByIdMatch = pathname.match(projectByIdPattern);
      if (projectByIdMatch) {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        const id = projectByIdMatch[1];

        if (method === "GET") {
          const project = instanceManager.projectManager.getProject(id);
          if (!project) {
            sendJson(res, 404, { error: "Project not found" });
            return;
          }
          sendJson(res, 200, project);
          return;
        }

        if (method === "PATCH") {
          try {
            const body = (await parseJsonBody(req)) as {
              name?: string;
              targetBranch?: string | null;
            };
            const project = instanceManager.projectManager.updateProject(id, body);
            if (!project) {
              sendJson(res, 404, { error: "Project not found" });
              return;
            }
            sendJson(res, 200, project);
          } catch (err) {
            sendJson(res, 400, {
              error: err instanceof Error ? err.message : "Failed to update project",
            });
          }
          return;
        }

        if (method === "DELETE") {
          const removed = instanceManager.projectManager.removeProject(id);
          if (removed) {
            sendJson(res, 200, { success: true });
          } else {
            sendJson(res, 404, { error: "Project not found" });
          }
          return;
        }
      }

      // GET /api/project-icons — cached project directory icon paths
      if (method === "GET" && pathname === "/api/project-icons") {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        sendJson(res, 200, instanceManager.getProjectIcons());
        return;
      }

      // GET /api/directories
      if (method === "GET" && pathname === "/api/directories") {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        sendJson(res, 200, {
          defaultDirectory: instanceManager.defaultWorkingDirectory,
          directories: instanceManager.getKnownDirectories(),
        });
        return;
      }

      // GET /api/git-repos — discover git repositories under home directory
      if (method === "GET" && pathname === "/api/git-repos") {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        sendJson(res, 200, { repos: await getGitRepos() });
        return;
      }

      // GET /api/browse?prefix=...&gitOnly=1  — list subdirectories for autocomplete
      if (method === "GET" && pathname === "/api/browse") {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        const home = homedir();
        const raw = parsedUrl.searchParams.get("prefix") || "";
        const gitOnly = parsedUrl.searchParams.get("gitOnly") === "1";
        const prefix = raw && raw !== "/" ? raw : home + "/";

        // Must stay under home directory
        const resolved = path.resolve(prefix);
        if (!resolved.startsWith(home)) {
          sendJson(res, 400, { error: "Path must be under home directory" });
          return;
        }

        // Determine parent dir and partial name to filter by
        let dirToRead: string;
        let partial: string;
        try {
          const stat = fs.statSync(resolved);
          if (stat.isDirectory() && prefix.endsWith("/")) {
            dirToRead = resolved;
            partial = "";
          } else if (stat.isDirectory()) {
            dirToRead = path.dirname(resolved);
            partial = path.basename(resolved);
          } else {
            dirToRead = path.dirname(resolved);
            partial = path.basename(resolved);
          }
        } catch {
          dirToRead = path.dirname(resolved);
          partial = path.basename(resolved);
        }

        try {
          const entries = fs.readdirSync(dirToRead, { withFileTypes: true });
          const lowerPartial = partial.toLowerCase();
          const dirs = entries
            .filter((e) => {
              if (!e.isDirectory()) return false;
              if (e.name.startsWith(".")) return false;
              if (!partial) return true;
              return e.name.toLowerCase().startsWith(lowerPartial);
            })
            .slice(0, 50) // read more candidates before git filtering
            .map((e) => path.join(dirToRead, e.name));

          if (gitOnly) {
            // Partition: git repos first, then non-git dirs (for navigation)
            const gitRepos: string[] = [];
            const nonGit: string[] = [];
            for (const d of dirs) {
              if (fs.existsSync(path.join(d, ".git"))) {
                gitRepos.push(d);
              } else {
                nonGit.push(d);
              }
            }
            sendJson(res, 200, {
              home,
              directories: [...gitRepos, ...nonGit].slice(0, 20),
              gitRepos,
            });
          } else {
            sendJson(res, 200, { home, directories: dirs.slice(0, 20) });
          }
        } catch {
          sendJson(res, 200, { home, directories: [], ...(gitOnly ? { gitRepos: [] } : {}) });
        }
        return;
      }

      // GET /api/workspace-entries?instanceId=...&q=...  — search files/directories for composer mentions
      if (method === "GET" && pathname === "/api/workspace-entries") {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        const instanceId = parsedUrl.searchParams.get("instanceId") || "";
        const query = parsedUrl.searchParams.get("q") || "";
        if (!instanceId) {
          sendJson(res, 400, { error: "instanceId is required" });
          return;
        }

        const entries = instanceManager.getWorkspaceEntries(instanceId, query);
        if (!entries) {
          sendJson(res, 404, { error: "Instance not found" });
          return;
        }

        sendJson(res, 200, { entries });
        return;
      }

      // GET /api/provider-models?provider=... — provider-scoped model metadata for the chat picker
      if (method === "GET" && pathname === "/api/provider-models") {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        const providerParam = parsedUrl.searchParams.get("provider");
        const provider = getAvailableProviders().find(
          (entry) => entry.provider === providerParam,
        )?.provider;
        if (!provider) {
          sendJson(res, 400, { error: "Invalid provider" });
          return;
        }

        try {
          const models = await getProviderModels(provider);
          sendJson(res, 200, {
            provider,
            models,
            capabilities: getProviderCapabilities(provider),
          });
        } catch (err) {
          sendJson(res, 500, {
            error: err instanceof Error ? err.message : "Failed to load provider models",
          });
        }
        return;
      }

      if (method === "GET" && pathname === "/api/providers") {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        sendJson(res, 200, { providers: getAvailableProviders() });
        return;
      }

      // GET /api/project-artifacts/:id — project artifacts (accepts basename slug or full encoded path)
      const projectMatch = pathname.match(/^\/api\/project-artifacts\/([-a-zA-Z0-9_.]+)$/);
      if (method === "GET" && projectMatch) {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        const id = projectMatch[1];
        const artifacts = instanceManager.getProjectArtifacts(id);
        if (!artifacts) {
          sendJson(res, 404, { error: "Project not found" });
          return;
        }
        sendJson(res, 200, artifacts);
        return;
      }

      // GET /api/open-targets?path=... — list native open targets for a local path
      if (method === "GET" && pathname === "/api/open-targets") {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        const targetPath = (parsedUrl.searchParams.get("path") || "").trim();
        if (!targetPath) {
          sendJson(res, 400, { error: "Missing path" });
          return;
        }
        if (!path.isAbsolute(targetPath)) {
          sendJson(res, 400, { error: "Path must be absolute" });
          return;
        }
        if (!fs.existsSync(targetPath)) {
          sendJson(res, 404, { error: "Path not found" });
          return;
        }

        try {
          sendJson(res, 200, await getOpenTargets(targetPath));
        } catch (err) {
          sendJson(res, 500, {
            error: err instanceof Error ? err.message : "Failed to load open targets",
          });
        }
        return;
      }

      // POST /api/open — ask the OS to open a local file path
      if (method === "POST" && pathname === "/api/open") {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        const body = (await parseJsonBody(req)) as {
          path?: string;
          line?: number;
          column?: number;
          targetId?: string;
          rememberForProject?: boolean;
        };
        const targetPath = typeof body.path === "string" ? body.path.trim() : "";
        if (!targetPath) {
          sendJson(res, 400, { error: "Missing path" });
          return;
        }
        if (!path.isAbsolute(targetPath)) {
          sendJson(res, 400, { error: "Path must be absolute" });
          return;
        }
        if (!fs.existsSync(targetPath)) {
          sendJson(res, 404, { error: "Path not found" });
          return;
        }

        try {
          await doOpenNativePath({
            path: targetPath,
            line: typeof body.line === "number" ? body.line : undefined,
            column: typeof body.column === "number" ? body.column : undefined,
            targetId: typeof body.targetId === "string" ? body.targetId : undefined,
            rememberForProject: body.rememberForProject === true,
          });
          sendJson(res, 200, { success: true });
        } catch (err) {
          sendJson(res, 500, {
            error: err instanceof Error ? err.message : "Failed to open path",
          });
        }
        return;
      }

      // POST /api/upload — upload an image file for attachment
      if (method === "POST" && pathname === "/api/upload") {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }

        const contentType = req.headers["content-type"] || "";
        const ALLOWED_MIMES: Record<string, string> = {
          "image/png": ".png",
          "image/jpeg": ".jpg",
          "image/gif": ".gif",
          "image/webp": ".webp",
          "image/svg+xml": ".svg",
          "image/bmp": ".bmp",
          "image/avif": ".avif",
        };
        const ext = ALLOWED_MIMES[contentType];
        if (!ext) {
          sendJson(res, 400, { error: "Unsupported image type" });
          return;
        }

        const MAX_UPLOAD = 10 * 1024 * 1024; // 10MB
        const contentLength = parseInt(req.headers["content-length"] || "0", 10);
        if (contentLength > MAX_UPLOAD) {
          sendJson(res, 413, { error: "File too large (10MB limit)" });
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        let responded = false;
        req.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_UPLOAD && !responded) {
            responded = true;
            sendJson(res, 413, { error: "File too large (10MB limit)" });
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on("end", () => {
          if (responded) return;
          responded = true;
          const data = Buffer.concat(chunks);
          const uploadsDir = path.join(homedir(), ".relay", "uploads");
          fs.mkdirSync(uploadsDir, { recursive: true });
          const filename = `${crypto.randomUUID()}${ext}`;
          const filePath = path.join(uploadsDir, filename);
          fs.writeFileSync(filePath, data);
          sendJson(res, 200, { path: filePath });
        });
        req.on("error", () => {
          if (responded) return;
          responded = true;
          sendJson(res, 500, { error: "Upload failed" });
        });
        return;
      }

      // GET /api/file?path=... — serve local image files for inline display
      if (method === "GET" && pathname === "/api/file") {
        if (!isAuthenticated) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        const filePath = parsedUrl.searchParams.get("path");
        if (!filePath) {
          sendJson(res, 400, { error: "Missing path parameter" });
          return;
        }
        const resolved = path.resolve(filePath);

        // Restrict to files under the user's home directory
        const home = homedir();
        if (!resolved.startsWith(home + path.sep) && resolved !== home) {
          sendJson(res, 403, { error: "Access denied: file must be under home directory" });
          return;
        }

        const ext = path.extname(resolved).toLowerCase();
        const IMAGE_EXTS = new Set([
          ".png",
          ".jpg",
          ".jpeg",
          ".gif",
          ".webp",
          ".svg",
          ".bmp",
          ".avif",
          ".ico",
        ]);
        if (!IMAGE_EXTS.has(ext)) {
          sendJson(res, 400, { error: "Only image files are supported" });
          return;
        }

        // Check file size before reading (10MB limit)
        const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
        try {
          const stat = fs.statSync(resolved);
          if (stat.size > MAX_IMAGE_SIZE) {
            sendJson(res, 413, { error: "File too large (10MB limit)" });
            return;
          }
        } catch {
          sendJson(res, 404, { error: "File not found" });
          return;
        }

        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        try {
          const data = fs.readFileSync(resolved);
          res.writeHead(200, {
            "Content-Type": contentType,
            "Content-Length": String(data.length),
            "Cache-Control": "public, max-age=3600",
          });
          res.end(data);
        } catch {
          sendJson(res, 404, { error: "File not found" });
        }
        return;
      }

      // =====================================================================
      // Static file serving (React SPA from ui/dist)
      // =====================================================================

      if (method === "GET" && config.serveUI) {
        // Serve static assets from ui/dist
        if (
          pathname.startsWith("/assets/") ||
          pathname === "/favicon.svg" ||
          pathname === "/favicon.ico" ||
          pathname === "/manifest.json"
        ) {
          const filePath = path.join(uiDistDir, pathname);
          // Path traversal guard
          const resolved = path.resolve(filePath);
          if (!resolved.startsWith(uiDistDir)) {
            sendHtml(res, 403, "<h1>Forbidden</h1>");
            return;
          }
          const isAsset = pathname.startsWith("/assets/");
          sendFile(res, resolved, isAsset);
          return;
        }

        // GET / — serve login for unauthenticated users, dashboard for others
        if (pathname === "/") {
          serveIndex(res);
          return;
        }

        // SPA fallback: /login, /projects/:id, /projects/:id/chats/:id all serve index.html
        // React Router handles which page renders
        serveIndex(res);
        return;
      }

      // Non-UI mode fallbacks
      if (method === "GET" && (pathname === "/" || pathname === "/login")) {
        if (isAuthenticated) {
          sendJson(res, 200, { status: "ok", authenticated: true });
        } else {
          sendJson(res, 200, { status: "ok", authenticated: false });
        }
        return;
      }

      if (method === "GET" && pathname.startsWith("/projects")) {
        if (!isAuthenticated) {
          redirect(res, "/login");
        } else {
          sendJson(res, 200, { status: "ok", authenticated: true });
        }
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
