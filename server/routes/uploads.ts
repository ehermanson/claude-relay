import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import type { Hono } from "hono";
import { relayDir } from "#core/config.js";
import { getMimeType, readBodyBuffer } from "#server/hono-utils.js";
import type { AppEnv, HttpDeps } from "#server/route-types.js";

// Content-Type -> file extension. Includes image types (rendered inline in
// the transcript) and file types (rendered as a clickable chip).
const ALLOWED_MIMES: Record<string, string> = {
  // images
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/bmp": ".bmp",
  "image/avif": ".avif",
  // documents / structured text
  "application/pdf": ".pdf",
  "application/json": ".json",
  "application/xml": ".xml",
  "application/yaml": ".yaml",
  "application/x-yaml": ".yaml",
  "application/sql": ".sql",
  "application/x-sql": ".sql",
  // text/*
  "text/plain": ".txt",
  "text/csv": ".csv",
  "text/markdown": ".md",
  "text/html": ".html",
  "text/xml": ".xml",
  "text/yaml": ".yaml",
  "text/x-diff": ".diff",
  "text/x-patch": ".patch",
};

const ALLOWED_EXTS = new Set([
  // images
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".avif",
  ".ico",
  // documents / structured text
  ".pdf",
  ".json",
  ".csv",
  ".md",
  ".txt",
  ".log",
  ".html",
  ".yaml",
  ".yml",
  ".xml",
  ".diff",
  ".patch",
  ".sql",
]);

const MAX_UPLOAD = 10 * 1024 * 1024;

export function registerUploadRoutes(app: Hono<AppEnv>, _: HttpDeps): void {
  app.post("/api/upload", async (c) => {
    // Content-Type from the browser may include a charset or boundary param —
    // strip everything after the first `;` before matching the allowlist.
    const rawContentType = c.req.header("content-type") || "";
    const contentType = rawContentType.split(";")[0]!.trim().toLowerCase();
    const ext = ALLOWED_MIMES[contentType];
    if (!ext) {
      return c.json({ error: "Unsupported file type" }, 400);
    }

    const contentLength = parseInt(c.req.header("content-length") || "0", 10);
    if (contentLength > MAX_UPLOAD) {
      return c.json({ error: "File too large (10MB limit)" }, 413);
    }

    try {
      const body = await readBodyBuffer(c, MAX_UPLOAD);
      const uploadsDir = path.join(relayDir, "uploads");
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
    if (!ALLOWED_EXTS.has(ext)) {
      return c.json({ error: "File type not allowed" }, 400);
    }

    try {
      const stat = fs.statSync(resolved);
      if (stat.size > MAX_UPLOAD) {
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
