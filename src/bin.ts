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
 */

import { spawn, type ChildProcess } from "child_process";
import { createRelay } from "./index.js";

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
});

let tunnelProcess: ChildProcess | null = null;

function startTunnel(localPort: number): void {
  console.log("  Starting cloudflared tunnel...");

  tunnelProcess = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${localPort}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  tunnelProcess.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(
        "\n  cloudflared not found. Install it:\n" +
        "    brew install cloudflared        (macOS)\n" +
        "    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n"
      );
    } else {
      console.error("  Tunnel error:", err.message);
    }
  });

  // cloudflared prints the URL to stderr
  let stderrBuf = "";
  tunnelProcess.stderr?.on("data", (data: Buffer) => {
    stderrBuf += data.toString();
    const match = stderrBuf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      console.log(`\n  Tunnel URL: ${match[0]}\n`);
      stderrBuf = ""; // stop accumulating
    }
  });

  tunnelProcess.on("close", (code) => {
    if (code !== null && code !== 0) {
      console.error(`  Tunnel exited with code ${code}`);
    }
    tunnelProcess = null;
  });
}

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

  if (tunnelProcess) {
    tunnelProcess.kill();
    tunnelProcess = null;
  }

  relay.stop().then(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
