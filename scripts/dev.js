#!/usr/bin/env node

/**
 * Dev launcher — finds a free port for the backend server, then spawns the
 * normal dev stack. Vite handles its own port automatically (strictPort is
 * off by default), and receives the backend port via env so its proxy targets
 * the right place.
 *
 * This lets multiple instances (e.g. worktrees) run `pnpm run dev` without
 * port conflicts.
 */

import net from "node:net";
import { execSync, spawn } from "node:child_process";

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "0.0.0.0");
  });
}

async function findFreePort(start, range = 20) {
  for (let port = start; port < start + range; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found in range ${start}–${start + range - 1}`);
}

const wantPort = parseInt(process.env.PORT || "7777");
const backendPort = await findFreePort(wantPort);

if (backendPort !== wantPort) {
  console.log(`Port ${wantPort} in use → backend on ${backendPort}`);
}

// Build TypeScript first
execSync("pnpm build:server", { stdio: "inherit" });

// Spawn concurrently with the resolved port — Vite reads PORT for its proxy config
const child = spawn(
  "npx",
  [
    "concurrently",
    "-n",
    "srv,tsc,ui",
    `DEV=1 PORT=${backendPort} node --watch-path=dist dist/bin.js`,
    "tsc --watch --preserveWatchOutput",
    `PORT=${backendPort} pnpm --filter relay-ui dev`,
  ],
  { stdio: "inherit", env: { ...process.env, PORT: String(backendPort) } },
);

child.on("exit", (code) => process.exit(code ?? 1));

// Forward signals for clean shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
