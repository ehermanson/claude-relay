import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import type { Route, HttpDeps } from "../types.js";
import { requireAuth } from "../guards.js";
import { getMimeType, sendJson } from "../respond.js";

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

export function createUploadRoutes(_: HttpDeps): Route[] {
  return [
    {
      method: "POST",
      pattern: /^\/api\/upload$/,
      handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }

        const contentType = ctx.req.headers["content-type"] || "";
        const allowedMimes: Record<string, string> = {
          "image/png": ".png",
          "image/jpeg": ".jpg",
          "image/gif": ".gif",
          "image/webp": ".webp",
          "image/svg+xml": ".svg",
          "image/bmp": ".bmp",
          "image/avif": ".avif",
        };
        const ext = allowedMimes[contentType];
        if (!ext) {
          sendJson(ctx.res, 400, { error: "Unsupported image type" });
          return;
        }

        const maxUpload = 10 * 1024 * 1024;
        const contentLength = parseInt(ctx.req.headers["content-length"] || "0", 10);
        if (contentLength > maxUpload) {
          sendJson(ctx.res, 413, { error: "File too large (10MB limit)" });
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        let responded = false;

        ctx.req.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxUpload && !responded) {
            responded = true;
            sendJson(ctx.res, 413, { error: "File too large (10MB limit)" });
            ctx.req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        ctx.req.on("end", () => {
          if (responded) return;
          responded = true;
          const uploadsDir = path.join(homedir(), ".relay", "uploads");
          fs.mkdirSync(uploadsDir, { recursive: true });
          const filePath = path.join(uploadsDir, `${crypto.randomUUID()}${ext}`);
          fs.writeFileSync(filePath, Buffer.concat(chunks));
          sendJson(ctx.res, 200, { path: filePath });
        });
        ctx.req.on("error", () => {
          if (responded) return;
          responded = true;
          sendJson(ctx.res, 500, { error: "Upload failed" });
        });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/file$/,
      handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }

        const filePath = ctx.parsedUrl.searchParams.get("path");
        if (!filePath) {
          sendJson(ctx.res, 400, { error: "Missing path parameter" });
          return;
        }

        const resolved = path.resolve(filePath);
        const home = homedir();
        if (!resolved.startsWith(home + path.sep) && resolved !== home) {
          sendJson(ctx.res, 403, { error: "Access denied: file must be under home directory" });
          return;
        }

        const ext = path.extname(resolved).toLowerCase();
        if (!IMAGE_EXTS.has(ext)) {
          sendJson(ctx.res, 400, { error: "Only image files are supported" });
          return;
        }

        const maxImageSize = 10 * 1024 * 1024;
        try {
          const stat = fs.statSync(resolved);
          if (stat.size > maxImageSize) {
            sendJson(ctx.res, 413, { error: "File too large (10MB limit)" });
            return;
          }
        } catch {
          sendJson(ctx.res, 404, { error: "File not found" });
          return;
        }

        try {
          const data = fs.readFileSync(resolved);
          ctx.res.writeHead(200, {
            "Content-Type": getMimeType(resolved),
            "Content-Length": String(data.length),
            "Cache-Control": "public, max-age=3600",
          });
          ctx.res.end(data);
        } catch {
          sendJson(ctx.res, 404, { error: "File not found" });
        }
      },
    },
  ];
}
