#!/usr/bin/env node

/**
 * Claude Relay CLI entry point
 *
 * Reads configuration from environment variables and starts the relay.
 *
 * Environment variables:
 *   RELAY_PASSWORD           (required) Password for authentication
 *   PORT                     (optional) Server port, default 7777
 *   SESSION_MAX_AGE          (optional) Session lifetime in ms, default 7 days
 *   PROCESS_TIMEOUT          (optional) Claude process timeout in ms, default 5 min
 *   WORKING_DIR              (optional) Working directory for Claude, default $HOME
 *   DANGEROUS_SKIP_PERMISSIONS (optional) Set to "true" to skip Claude permission prompts
 *   MAX_PROCESSES             (optional) Maximum concurrent managed processes, default 15
 *   MAX_INSTANCES             (deprecated) Alias for MAX_PROCESSES
 *   TUNNEL                   (optional) Set to "true" to start a cloudflared tunnel
 *   SESSION_FILE             (optional) Path to session persistence file, default ~/.claude-relay/sessions.json
 *   DB_PATH                  (optional) Path to SQLite database, default ~/.claude-relay/sessions.db
 *   DEFAULT_MODEL            (optional) Default model for new sessions, default "claude-opus-4-6"
 *   MANIFEST_FILE            (optional) Legacy manifest file path (used for one-time migration to SQLite)
 */

import { createRelay } from "./server/index.js";
import { startTunnel, stopTunnel } from "./server/tunnel.js";

const password = process.env.RELAY_PASSWORD;

if (!password) {
  console.error(
    "Error: RELAY_PASSWORD environment variable is required.\n" +
      "  Set it with: RELAY_PASSWORD=your-secret npm start",
  );
  process.exit(1);
}

const port = parseInt(process.env.PORT || "7777");
const enableTunnel = process.env.TUNNEL === "true";

const relay = createRelay({
  password,
  port,
  sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE || String(7 * 24 * 60 * 60 * 1000)),
  processTimeout: parseInt(process.env.PROCESS_TIMEOUT || String(5 * 60 * 1000)),
  workingDirectory: process.env.WORKING_DIR || process.env.HOME || process.cwd(),
  dangerouslySkipPermissions: process.env.DANGEROUS_SKIP_PERMISSIONS === "true",
  maxProcesses: parseInt(
    process.env.MAX_PROCESSES ||
      (() => {
        if (process.env.MAX_INSTANCES) {
          console.warn("Warning: MAX_INSTANCES is deprecated, use MAX_PROCESSES instead");
          return process.env.MAX_INSTANCES;
        }
        return "15";
      })(),
  ),
  defaultModel: process.env.DEFAULT_MODEL || "claude-opus-4-6",
  serveUI: true,
  ...(process.env.SESSION_FILE ? { sessionFile: process.env.SESSION_FILE } : {}),
  ...(process.env.DB_PATH ? { dbPath: process.env.DB_PATH } : {}),
  ...(process.env.MANIFEST_FILE ? { manifestFile: process.env.MANIFEST_FILE } : {}),
});

relay
  .start()
  .then(() => {
    if (process.env.DEV) {
      console.log(`Claude Relay UI at http://localhost:5173\n`);
    } else if (enableTunnel) {
      startTunnel(port);
    } else {
      console.log(`  Expose with: TUNNEL=true RELAY_PASSWORD=... npm start\n`);
    }
  })
  .catch((err: Error) => {
    console.error(`\n  Failed to start Claude Relay: ${err.message}`);
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.error(
        `  Port ${port} is already in use. Try a different port with: PORT=8888 npm start`,
      );
    }
    process.exit(1);
  });

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("\nShutting down...");

  stopTunnel();

  relay.stop().then(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
