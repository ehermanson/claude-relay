import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import http from "http";
import type { IncomingMessage } from "http";
import type { Plugin } from "vite";

const BACKEND_PORT = parseInt(process.env.PORT || "7777");
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
const VITE_PORT = parseInt(process.env.VITE_PORT || "5173");

/** Vite plugin to proxy non-HMR WebSocket upgrades to the relay server */
function isViteHmrUpgrade(req: IncomingMessage): boolean {
  const protocolHeader = req.headers["sec-websocket-protocol"];
  const protocols = Array.isArray(protocolHeader)
    ? protocolHeader
    : (protocolHeader ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
  return protocols.includes("vite-hmr") || protocols.includes("vite-ping");
}

function wsProxy(): Plugin {
  return {
    name: "ws-proxy",
    configureServer(server) {
      server.httpServer?.on("upgrade", (req, socket) => {
        if (req.headers.upgrade?.toLowerCase() !== "websocket") return;
        if (isViteHmrUpgrade(req)) return;

        // The Relay app socket lives at the root path. Let Vite keep any
        // other upgrade paths for itself.
        if (req.url && req.url !== "/") return;

        const proxyReq = http.request({
          hostname: "localhost",
          port: BACKEND_PORT,
          path: req.url || "/",
          method: req.method,
          headers: req.headers,
        });

        proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
          socket.write(
            `HTTP/1.1 101 Switching Protocols\r\n` +
              Object.entries(proxyRes.headers)
                .map(([k, v]) => `${k}: ${v}`)
                .join("\r\n") +
              "\r\n\r\n",
          );
          if (proxyHead.length) socket.write(proxyHead);
          proxySocket.on("error", () => socket.destroy());
          socket.on("error", () => proxySocket.destroy());
          proxySocket.pipe(socket);
          socket.pipe(proxySocket);
        });

        proxyReq.on("error", () => socket.destroy());
        proxyReq.end();
      });
    },
  };
}

/** Vite plugin to swap favicon to blueprint style in dev */
function devFavicon(): Plugin {
  return {
    name: "dev-favicon",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (ctx.server) {
          return html.replace(/href="\/favicon\.svg"/g, 'href="/favicon-dev.svg"');
        }
        return html;
      },
    },
  };
}

export default defineConfig({
  plugins: [
    devtools(),
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react({ babel: { plugins: [["babel-plugin-react-compiler", {}]] } }),
    wsProxy(),
    devFavicon(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../server/core"),
    },
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: [".ts.net"],
    port: VITE_PORT,
    strictPort: true,
    proxy: {
      "/api": BACKEND_URL,
      "/auth": BACKEND_URL,
      "/logout": BACKEND_URL,
      "/health": BACKEND_URL,
    },
  },
});
