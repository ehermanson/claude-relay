#!/usr/bin/env node

/**
 * Relay CLI entry point
 *
 * Reads configuration from environment variables and either starts the relay
 * or runs a local export/import migration command.
 *
 * Environment variables:
 *   RELAY_PASSWORD           (required for server mode) Password for authentication
 *   PORT                     (optional) Server port, default 7777
 *   SESSION_MAX_AGE          (optional) Session lifetime in ms, default 7 days
 *   PROCESS_TIMEOUT          (optional) Claude process timeout in ms, default 5 min
 *   WORKING_DIR              (optional) Working directory for Claude, default $HOME
 *   MAX_PROCESSES             (optional) Maximum concurrent managed processes, default 15
 *   MAX_INSTANCES             (deprecated) Alias for MAX_PROCESSES
 *   TUNNEL                   (optional) Set to "true" to start a cloudflared tunnel
 *   SESSION_FILE             (optional) Path to session persistence file, default ~/.relay/sessions.json
 *   DB_PATH                  (optional) Path to SQLite database, default ~/.relay/sessions.db
 *   DEFAULT_MODEL            (optional) Default model for new sessions, default "claude-opus-4-6"
 *   MANIFEST_FILE            (optional) Legacy manifest file path (used for one-time migration to SQLite)
 *   CLAUDE_DIR               (optional) Claude data directory, default ~/.claude
 *   CODEX_DIR                (optional) Codex data directory, default ~/.codex
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { createRelay } from "./server/index.js";
import { startTunnel, stopTunnel } from "./server/tunnel.js";
import {
  exportRelayArchive,
  exportRelayData,
  importRelayArchive,
  importRelayData,
} from "./core/migration.js";
import { resolveCoreConfig } from "./core/config.js";

const args = process.argv.slice(2);
const command = args[0];

if (
  command === "export" ||
  command === "import" ||
  command === "export-tgz" ||
  command === "import-tgz" ||
  command === "--help" ||
  command === "-h"
) {
  runCliCommand(command, args.slice(1)).catch((err: Error) => {
    console.error(`\n  ${err.message}`);
    process.exit(1);
  });
} else {
  startServer();
}

function printUsage(): void {
  console.log(`Usage:
  relay
  relay export <output-dir>
  relay import <bundle-dir>
  relay export-tgz <archive.tgz>
  relay import-tgz <archive.tgz>

Notes:
  - migration commands do not require RELAY_PASSWORD
  - export/import use a directory bundle with manifest + DB snapshot + transcript files
  - export-tgz/import-tgz wrap the same bundle format in a .tgz archive
  - import merges transcripts into local ~/.claude / ~/.codex by default`);
}

async function runCliCommand(commandName: string | undefined, args: string[]): Promise<void> {
  if (commandName === "--help" || commandName === "-h") {
    printUsage();
    return;
  }

  const targetPath = args[0];
  if (!targetPath) {
    printUsage();
    throw new Error(`Missing path for relay ${commandName}`);
  }

  const config = resolveCoreConfig({
    dbPath: process.env.DB_PATH,
    claudeDir: process.env.CLAUDE_DIR,
    codexDir: process.env.CODEX_DIR,
  });

  if (commandName === "export") {
    const summary = await exportRelayData({ ...config, logger: config.logger }, targetPath);
    console.log(`Exported Relay data to ${summary.outputDir}`);
    console.log(`  DB snapshot: ${summary.dbIncluded ? "included" : "not found"}`);
    console.log(`  Claude JSONL files: ${summary.claudeTranscriptFiles}`);
    console.log(`  Codex JSONL files: ${summary.codexTranscriptFiles}`);
    console.log(`  Manifest: ${summary.manifestPath}`);
    return;
  }

  if (commandName === "export-tgz") {
    const summary = await exportRelayArchive({ ...config, logger: config.logger }, targetPath);
    console.log(`Exported Relay data to ${summary.archivePath}`);
    console.log(`  DB snapshot: ${summary.dbIncluded ? "included" : "not found"}`);
    console.log(`  Claude JSONL files: ${summary.claudeTranscriptFiles}`);
    console.log(`  Codex JSONL files: ${summary.codexTranscriptFiles}`);
    return;
  }

  if (commandName === "import") {
    const summary = importRelayData({ ...config, logger: config.logger }, targetPath);
    console.log(`Imported Relay data from ${summary.inputDir}`);
    console.log(
      `  Transcripts: ${summary.transcriptFilesCopied} copied, ${summary.transcriptFilesUpdated} updated, ${summary.transcriptFilesSkipped} skipped, ${summary.transcriptConflicts} conflicts`,
    );
    console.log(
      `  DB rows: ${summary.sessionRowsMerged} sessions, ${summary.managedRowsMerged} managed`,
    );
    console.log(`  Metadata: ${summary.projectsMerged} projects, ${summary.spacesMerged} spaces`);
    return;
  }

  if (commandName === "import-tgz") {
    const summary = importRelayArchive({ ...config, logger: config.logger }, targetPath);
    console.log(`Imported Relay data from ${targetPath}`);
    console.log(
      `  Transcripts: ${summary.transcriptFilesCopied} copied, ${summary.transcriptFilesUpdated} updated, ${summary.transcriptFilesSkipped} skipped, ${summary.transcriptConflicts} conflicts`,
    );
    console.log(
      `  DB rows: ${summary.sessionRowsMerged} sessions, ${summary.managedRowsMerged} managed`,
    );
    console.log(`  Metadata: ${summary.projectsMerged} projects, ${summary.spacesMerged} spaces`);
    return;
  }

  printUsage();
  throw new Error(`Unknown command: ${commandName}`);
}

function startServer(): void {
  const password = process.env.RELAY_PASSWORD;

  if (!password) {
    console.error(
      "Error: RELAY_PASSWORD environment variable is required.\n" +
        "  Set it with: RELAY_PASSWORD=your-secret pnpm start",
    );
    process.exit(1);
  }

  const port = parseInt(process.env.PORT || "7777");
  const enableTunnel = process.env.TUNNEL === "true";
  const home = homedir();

  const relay = createRelay({
    password,
    port,
    sessionMaxAge: parseInt(process.env.SESSION_MAX_AGE || String(7 * 24 * 60 * 60 * 1000)),
    processTimeout: parseInt(process.env.PROCESS_TIMEOUT || String(5 * 60 * 1000)),
    workingDirectory: process.env.WORKING_DIR || process.env.HOME || process.cwd(),
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
    ...(process.env.CLAUDE_DIR
      ? {
          providerDirs: {
            claude: process.env.CLAUDE_DIR,
            codex: process.env.CODEX_DIR ?? join(home, ".codex"),
          },
        }
      : {}),
    ...(process.env.CODEX_DIR && !process.env.CLAUDE_DIR
      ? { providerDirs: { claude: join(home, ".claude"), codex: process.env.CODEX_DIR } }
      : {}),
  });

  relay
    .start()
    .then(() => {
      if (process.env.DEV) {
        console.log(`Relay UI at http://localhost:5173\n`);
      } else if (enableTunnel) {
        startTunnel(port);
      } else {
        console.log(`  Expose with: TUNNEL=true RELAY_PASSWORD=... pnpm start\n`);
      }
    })
    .catch((err: Error) => {
      console.error(`\n  Failed to start Relay: ${err.message}`);
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        console.error(
          `  Port ${port} is already in use. Try a different port with: PORT=8888 pnpm start`,
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
}
