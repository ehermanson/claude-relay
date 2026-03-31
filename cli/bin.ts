#!/usr/bin/env node

/**
 * Relay CLI entry point
 *
 * Usage:
 *   relay start [options]       Start the relay server
 *
 * Start options:
 *   --port <number>             Server port (default: 7777, env: PORT)
 *   --password <string>         Require password for auth (env: RELAY_PASSWORD)
 *   --tunnel                    Start a cloudflared tunnel (env: TUNNEL=true)
 *
 * Environment variables (all optional):
 *   RELAY_PASSWORD              Password for authentication (or use --password)
 *   PORT                        Server port (or use --port)
 *   TUNNEL                      Set to "true" to start a cloudflared tunnel
 *   SESSION_MAX_AGE             Session lifetime in ms, default 7 days
 *   PROCESS_TIMEOUT             Claude process timeout in ms, default 5 min
 *   WORKING_DIR                 Working directory for Claude, default cwd
 *   MAX_PROCESSES               Maximum concurrent managed processes, default 15
 *   SESSION_FILE                Path to session persistence file
 *   DB_PATH                     Path to SQLite database
 *   DEFAULT_MODEL               Default model for new sessions
 *   CLAUDE_DIR                  Claude data directory, default ~/.claude
 *   CODEX_DIR                   Codex data directory, default ~/.codex
 *   GEMINI_DIR                  Gemini data directory, default ~/.gemini
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { createRelay } from "#server/index.js";
import { startTunnel, stopTunnel } from "#server/tunnel.js";

// ---------- Arg parsing helpers ----------

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

// ---------- Main dispatch ----------

const args = process.argv.slice(2);
const command = args[0];

if (command === "--help" || command === "-h") {
  printUsage();
} else if (command === "start") {
  startServer(args.slice(1));
} else if (!command) {
  // Bare `relay` with no args — start the server (backwards compat)
  startServer(args);
} else {
  console.error(`Unknown command: ${command}\n`);
  printUsage();
  process.exit(1);
}

function printUsage(): void {
  console.log(`Usage:
  relay start [--port <number>] [--password <string>] [--tunnel]

Options:
  --port <number>     Server port (default: 7777)
  --password <string> Require password for authentication
  --tunnel            Expose via cloudflared tunnel

Notes:
  - When no password is set, the server runs in open mode (no login required).
    Set a password if you plan to expose the server over a tunnel or network.`);
}

function startServer(cliArgs: string[]): void {
  const password = parseFlag(cliArgs, "--password") || process.env.RELAY_PASSWORD || undefined;
  const port = parseInt(parseFlag(cliArgs, "--port") || process.env.PORT || "7777");
  const enableTunnel = hasFlag(cliArgs, "--tunnel") || process.env.TUNNEL === "true";
  const home = homedir();

  // Warn if exposing via tunnel without a password
  if (enableTunnel && !password) {
    console.warn(
      "Warning: Starting tunnel without a password. Anyone with the URL can access Relay.\n" +
        "  Set a password with: relay start --password <secret> --tunnel\n",
    );
  }

  const relay = createRelay({
    password,
    port,
    sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE || String(7 * 24 * 60 * 60 * 1000)),
    processTimeout: parseInt(process.env.PROCESS_TIMEOUT || String(5 * 60 * 1000)),
    workingDirectory: process.env.WORKING_DIR || process.cwd(),
    maxProcesses: parseInt(process.env.MAX_PROCESSES || "15"),
    defaultModel: process.env.DEFAULT_MODEL || "claude-opus-4-6",
    serveUI: true,
    ...(process.env.SESSION_FILE ? { sessionFile: process.env.SESSION_FILE } : {}),
    ...(process.env.DB_PATH ? { dbPath: process.env.DB_PATH } : {}),
    providerDirs: {
      claude: process.env.CLAUDE_DIR ?? join(home, ".claude"),
      codex: process.env.CODEX_DIR ?? join(home, ".codex"),
      gemini: process.env.GEMINI_DIR ?? join(home, ".gemini"),
    },
  });

  relay
    .start()
    .then(() => {
      if (process.env.DEV) {
        console.log(`Relay UI at http://localhost:${process.env.VITE_PORT || "5173"}\n`);
      } else if (enableTunnel) {
        startTunnel(port);
      }
    })
    .catch((err: Error) => {
      console.error(`\n  Failed to start Relay: ${err.message}`);
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        console.error(
          `  Port ${port} is already in use. Try a different port with: relay start --port 8888`,
        );
        console.error(`  To inspect the current listener: lsof -nP -iTCP:${port} -sTCP:LISTEN`);
      }
      process.exit(1);
    });

  let stopping = false;
  function shutdown() {
    if (stopping) return;
    stopping = true;
    console.log("\nShutting down...");

    stopTunnel();

    const forceExit = setTimeout(() => process.exit(1), 10000);
    forceExit.unref();

    relay.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Log unhandled rejections so crashes leave a trail.
  // Node 15+ exits on unhandled rejections by default — this ensures we see why.
  process.on("unhandledRejection", (reason) => {
    console.error("[FATAL] Unhandled rejection:", reason);
  });
}
