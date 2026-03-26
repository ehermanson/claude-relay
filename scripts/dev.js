#!/usr/bin/env node

/**
 * Dev launcher — finds free ports for both the backend server and the Vite
 * dev server, then spawns the normal dev stack. Each receives its resolved
 * port via env so the proxy always targets the right backend.
 *
 * This lets multiple instances (e.g. worktrees) run `pnpm run dev` without
 * port conflicts.
 */

import net from "node:net";
import path from "node:path";
import { execFileSync, execSync, spawn } from "node:child_process";

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

/** Detect git branch and whether we're in a worktree. */
function getGitContext() {
  try {
    const opts = { encoding: "utf8", timeout: 2000 };
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], opts).trim();
    const gitDir = path.resolve(execFileSync("git", ["rev-parse", "--git-dir"], opts).trim());
    const commonDir = path.resolve(
      execFileSync("git", ["rev-parse", "--git-common-dir"], opts).trim(),
    );
    return { branch, isWorktree: gitDir !== commonDir };
  } catch {
    return null;
  }
}

const wantBackend = parseInt(process.env.PORT || "7777");
const wantVite = parseInt(process.env.VITE_PORT || "5173");

const backendPort = await findFreePort(wantBackend);
const vitePort = await findFreePort(wantVite);

// Print a startup banner so it's clear which instance is which
const git = getGitContext();
const context = git ? `${git.branch}${git.isWorktree ? " (worktree)" : ""}` : "unknown";
console.log();
console.log(`  Relay Dev  ─  ${context}`);
console.log(`  Backend    →  http://localhost:${backendPort}`);
console.log(`  UI         →  http://localhost:${vitePort}`);
console.log();

// Build TypeScript first
execSync("pnpm build:server", { stdio: "inherit" });

// Spawn concurrently with the resolved ports
const child = spawn(
  "npx",
  [
    "concurrently",
    "-n",
    "srv,tsc,ui",
    `DEV=1 PORT=${backendPort} node --watch-path=dist dist/bin.js`,
    "tsc --watch --preserveWatchOutput",
    `PORT=${backendPort} VITE_PORT=${vitePort} pnpm --filter relay-ui dev`,
  ],
  {
    stdio: "inherit",
    env: { ...process.env, PORT: String(backendPort), VITE_PORT: String(vitePort) },
  },
);

child.on("exit", (code) => process.exit(code ?? 1));

// Forward signals for clean shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
