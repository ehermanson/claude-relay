import http from "node:http";
import fs from "node:fs";
import path from "node:path";

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
  ".bmp": "image/bmp",
};

export function getMimeType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

export function sendFile(res: http.ServerResponse, filePath: string, isAsset: boolean): void {
  try {
    const data = fs.readFileSync(filePath);
    const headers: Record<string, string> = {
      "Content-Type": getMimeType(filePath),
      "Content-Length": String(data.length),
      "Cache-Control": isAsset ? "public, max-age=31536000, immutable" : "no-cache",
    };

    res.writeHead(200, headers);
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

export function sendHtml(res: http.ServerResponse, statusCode: number, html: string): void {
  res.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
  });
  res.end(html);
}

export function sendJson(
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

export function redirect(
  res: http.ServerResponse,
  location: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(302, { Location: location, ...headers });
  res.end();
}

export function serveIndex(res: http.ServerResponse, indexHtmlPath: string): void {
  try {
    const html = fs.readFileSync(indexHtmlPath, "utf-8");
    sendHtml(res, 200, html);
  } catch {
    sendHtml(res, 500, "<h1>UI not built. Run: pnpm build:ui</h1>");
  }
}
