import { defineConfig } from "vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import http from "http";
import type { Plugin } from "vite";

/** Vite plugin to proxy non-HMR WebSocket upgrades to the relay server */
function wsProxy(): Plugin {
  return {
    name: "ws-proxy",
    configureServer(server) {
      server.httpServer?.on("upgrade", (req, socket, head) => {
        // Let Vite handle its own HMR WebSocket
        if (req.url?.startsWith("/@") || req.url === "/") {
          // Only proxy root-level WS connections (no path = our app WS)
        }

        // Skip Vite HMR paths
        if (req.url && req.url !== "/") return;

        const proxyReq = http.request({
          hostname: "localhost",
          port: 7777,
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

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react({ babel: { plugins: [["babel-plugin-react-compiler", {}]] } }),
    wsProxy(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "../src/core"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:7777",
      "/auth": "http://localhost:7777",
      "/logout": "http://localhost:7777",
      "/health": "http://localhost:7777",
    },
  },
});
