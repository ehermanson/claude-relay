import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import type { Hono } from "hono";
import { getMimeType, readBodyBuffer } from "../hono-utils.js";
import type { AppEnv, HttpDeps } from "../types.js";

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

export function registerUploadRoutes(app: Hono<AppEnv>, _: HttpDeps): void {
  app.post("/api/upload", async (c) => {
    const contentType = c.req.header("content-type") || "";
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
      return c.json({ error: "Unsupported image type" }, 400);
    }

    const maxUpload = 10 * 1024 * 1024;
    const contentLength = parseInt(c.req.header("content-length") || "0", 10);
    if (contentLength > maxUpload) {
      return c.json({ error: "File too large (10MB limit)" }, 413);
    }

    try {
      const body = await readBodyBuffer(c, maxUpload);
      const uploadsDir = path.join(homedir(), ".relay", "uploads");
      fs.mkdirSync(uploadsDir, { recursive: true });
      const filePath = path.join(uploadsDir, `${crypto.randomUUID()}${ext}`);
      fs.writeFileSync(filePath, body);
      return c.json({ path: filePath });
    } catch (err) {
      if (err instanceof Error && err.message === "Body too large") {
        return c.json({ error: "File too large (10MB limit)" }, 413);
      }
      return c.json({ error: "Upload failed" }, 500);
    }
  });

  app.get("/api/file", (c) => {
    const filePath = c.req.query("path");
    if (!filePath) {
      return c.json({ error: "Missing path parameter" }, 400);
    }

    const resolved = path.resolve(filePath);
    const home = homedir();
    if (!resolved.startsWith(home + path.sep) && resolved !== home) {
      return c.json({ error: "Access denied: file must be under home directory" }, 403);
    }

    const ext = path.extname(resolved).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) {
      return c.json({ error: "Only image files are supported" }, 400);
    }

    const maxImageSize = 10 * 1024 * 1024;
    try {
      const stat = fs.statSync(resolved);
      if (stat.size > maxImageSize) {
        return c.json({ error: "File too large (10MB limit)" }, 413);
      }
    } catch {
      return c.json({ error: "File not found" }, 404);
    }

    try {
      const data = fs.readFileSync(resolved);
      return new Response(data, {
        status: 200,
        headers: {
          "Content-Type": getMimeType(resolved),
          "Content-Length": String(data.length),
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch {
      return c.json({ error: "File not found" }, 404);
    }
  });
}
