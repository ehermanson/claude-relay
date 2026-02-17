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
 *   MAX_INSTANCES             (optional) Maximum concurrent instances, default 10
 *   TUNNEL                   (optional) Set to "true" to start a cloudflared tunnel
 *   SESSION_FILE             (optional) Path to session persistence file, default ~/.claude-relay/sessions.json
 *   MANIFEST_FILE            (optional) Path to instance manifest file, default ~/.claude-relay/instances.json
 */

import { createRelay } from "./server/index.js";
import { startTunnel, stopTunnel } from "./server/tunnel.js";

const password = process.env.RELAY_PASSWORD;

if (!password) {
  console.error(
    "Error: RELAY_PASSWORD environment variable is required.\n" +
    "  Set it with: RELAY_PASSWORD=your-secret npm start"
  );
  process.exit(1);
}

const port = parseInt(process.env.PORT || "7777");
const enableTunnel = process.env.TUNNEL === "true";

const relay = createRelay({
  password,
  port,
  sessionMaxAge: parseInt(
    process.env.SESSION_MAX_AGE || String(7 * 24 * 60 * 60 * 1000)
  ),
  processTimeout: parseInt(
    process.env.PROCESS_TIMEOUT || String(5 * 60 * 1000)
  ),
  workingDirectory: process.env.WORKING_DIR || process.env.HOME || process.cwd(),
  dangerouslySkipPermissions: process.env.DANGEROUS_SKIP_PERMISSIONS === "true",
  maxInstances: parseInt(process.env.MAX_INSTANCES || "10"),
  serveUI: true,
  ...(process.env.SESSION_FILE ? { sessionFile: process.env.SESSION_FILE } : {}),
  ...(process.env.MANIFEST_FILE ? { manifestFile: process.env.MANIFEST_FILE } : {}),
});

relay.start().then(() => {
  console.log(`\n  Claude Relay running at http://localhost:${port}`);

  if (enableTunnel) {
    startTunnel(port);
  } else {
    console.log(`  Expose with: TUNNEL=true RELAY_PASSWORD=... npm start\n`);
  }
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
