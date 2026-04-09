#!/usr/bin/env node

/**
 * Dev launcher — runs the server directly from TypeScript source using Node's
 * native type stripping (no tsc --watch, no dist/ dependency). Finds free ports
 * for both the backend and Vite dev server so multiple instances (e.g. worktrees)
 * can coexist.
 *
 * The server does NOT auto-restart on file changes. This is intentional —
 * it prevents the "using the tool to work on the tool" problem where AI agents
 * modifying server files would trigger disruptive restarts mid-operation.
 * Restart manually with Ctrl+C / re-run, or press 'r' to restart the server.
 */

import net from "node:net";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

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

const git = getGitContext();
const context = git ? `${git.branch}${git.isWorktree ? " (worktree)" : ""}` : "unknown";
console.log();
console.log(`  Relay Dev  ─  ${context}`);
console.log(`  Backend    →  http://localhost:${backendPort}`);
console.log(`  UI         →  http://localhost:${vitePort}`);
console.log(`  Press 'r' to restart the server`);
console.log();

// --- Server process management ---

const serverEnv = {
  ...process.env,
  DEV: "1",
  PORT: String(backendPort),
  VITE_PORT: String(vitePort),
};

let serverProc = null;

function startServer() {
  serverProc = spawn("node", ["--conditions=relay-dev", "cli/bin.ts"], {
    stdio: "inherit",
    env: serverEnv,
  });
  serverProc.on("exit", (code, signal) => {
    if (signal) return; // killed intentionally
    if (code !== 0) {
      console.error(`\n  Server exited with code ${code}`);
    }
  });
}

function restartServer() {
  console.log("\n  Restarting server...\n");
  if (serverProc) {
    serverProc.once("exit", () => startServer());
    serverProc.kill("SIGTERM");
  } else {
    startServer();
  }
}

// --- Vite dev server ---

// Run vite directly via `pnpm exec` from the app workspace instead of
// `pnpm --filter relay-app dev`. The filter/recursive runner treats SIGTERM
// exits (code 143) as failures and prints ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL
// on every clean Ctrl+C; `pnpm exec` just forwards the signal cleanly.
const viteProc = spawn("pnpm", ["exec", "vite"], {
  stdio: "inherit",
  cwd: path.resolve(import.meta.dirname, "..", "app"),
  env: { ...process.env, PORT: String(backendPort), VITE_PORT: String(vitePort) },
});

// --- Keyboard input: 'r' to restart server ---

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (data) => {
    const key = data.toString();
    if (key === "r" || key === "R") {
      restartServer();
    } else if (key === "\x03") {
      // Ctrl+C
      shutdown();
    }
  });
}

// --- Start ---

startServer();

// --- Shutdown ---

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("\nShutting down...");
  if (serverProc) serverProc.kill("SIGTERM");
  viteProc.kill("SIGTERM");
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
viteProc.on("exit", () => {
  if (!stopping) shutdown();
});
