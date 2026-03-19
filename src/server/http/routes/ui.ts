import path from "node:path";
import type { Route, HttpDeps } from "../types.js";
import { redirect, sendHtml, sendJson, sendFile, serveIndex } from "../respond.js";

export function createUiRoutes(deps: HttpDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: /^\/.*$/,
      handler(ctx) {
        if (deps.config.serveUI) {
          if (
            ctx.pathname.startsWith("/assets/") ||
            ctx.pathname === "/favicon.svg" ||
            ctx.pathname === "/favicon.ico" ||
            ctx.pathname === "/manifest.json"
          ) {
            const filePath = path.join(deps.uiDistDir, ctx.pathname);
            const resolved = path.resolve(filePath);
            if (!resolved.startsWith(deps.uiDistDir)) {
              sendHtml(ctx.res, 403, "<h1>Forbidden</h1>");
              return;
            }
            sendFile(ctx.res, resolved, ctx.pathname.startsWith("/assets/"));
            return;
          }

          serveIndex(ctx.res, deps.indexHtmlPath);
          return;
        }

        if (ctx.pathname === "/" || ctx.pathname === "/login") {
          sendJson(ctx.res, 200, { status: "ok", authenticated: ctx.isAuthenticated });
          return;
        }

        if (ctx.pathname.startsWith("/projects")) {
          if (!ctx.isAuthenticated) {
            redirect(ctx.res, "/login");
            return;
          }
          sendJson(ctx.res, 200, { status: "ok", authenticated: true });
          return;
        }

        sendHtml(ctx.res, 404, "<h1>404 Not Found</h1>");
      },
    },
  ];
}
