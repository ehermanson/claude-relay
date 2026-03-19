import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import type { Route, HttpDeps } from "../types.js";
import { requireAuth } from "../guards.js";
import { sendJson } from "../respond.js";

export function createWorkspaceRoutes(deps: HttpDeps): Route[] {
  const { instanceManager } = deps;

  return [
    {
      method: "GET",
      pattern: /^\/api\/directories$/,
      handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }
        sendJson(ctx.res, 200, {
          defaultDirectory: instanceManager.defaultWorkingDirectory,
          directories: instanceManager.getKnownDirectories(),
        });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/git-repos$/,
      async handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }
        sendJson(ctx.res, 200, { repos: await deps.getGitRepos() });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/browse$/,
      handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }
        const home = homedir();
        const raw = ctx.parsedUrl.searchParams.get("prefix") || "";
        const gitOnly = ctx.parsedUrl.searchParams.get("gitOnly") === "1";
        const prefix = raw && raw !== "/" ? raw : home + "/";
        const resolved = path.resolve(prefix);

        if (!resolved.startsWith(home)) {
          sendJson(ctx.res, 400, { error: "Path must be under home directory" });
          return;
        }

        let dirToRead: string;
        let partial: string;
        try {
          const stat = fs.statSync(resolved);
          if (stat.isDirectory() && prefix.endsWith("/")) {
            dirToRead = resolved;
            partial = "";
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
            .filter((entry) => {
              if (!entry.isDirectory()) return false;
              if (entry.name.startsWith(".")) return false;
              if (!partial) return true;
              return entry.name.toLowerCase().startsWith(lowerPartial);
            })
            .slice(0, 50)
            .map((entry) => path.join(dirToRead, entry.name));

          if (gitOnly) {
            const gitRepos: string[] = [];
            const nonGit: string[] = [];
            for (const dir of dirs) {
              if (fs.existsSync(path.join(dir, ".git"))) {
                gitRepos.push(dir);
              } else {
                nonGit.push(dir);
              }
            }
            sendJson(ctx.res, 200, {
              home,
              directories: [...gitRepos, ...nonGit].slice(0, 20),
              gitRepos,
            });
            return;
          }

          sendJson(ctx.res, 200, { home, directories: dirs.slice(0, 20) });
        } catch {
          sendJson(ctx.res, 200, { home, directories: [], ...(gitOnly ? { gitRepos: [] } : {}) });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/workspace-entries$/,
      handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }
        const instanceId = ctx.parsedUrl.searchParams.get("instanceId") || "";
        const query = ctx.parsedUrl.searchParams.get("q") || "";
        if (!instanceId) {
          sendJson(ctx.res, 400, { error: "instanceId is required" });
          return;
        }
        const entries = instanceManager.getWorkspaceEntries(instanceId, query);
        if (!entries) {
          sendJson(ctx.res, 404, { error: "Instance not found" });
          return;
        }
        sendJson(ctx.res, 200, { entries });
      },
    },
  ];
}
