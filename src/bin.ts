#!/usr/bin/env node

/**
 * Relay CLI entry point
 *
 * Usage:
 *   relay start [options]       Start the relay server
 *   relay export <output-dir>   Export data to a directory bundle
 *   relay import <bundle-dir>   Import data from a directory bundle
 *   relay export-tgz <file>     Export data as a .tgz archive
 *   relay import-tgz <file>     Import data from a .tgz archive
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

if (
  command === "export" ||
  command === "import" ||
  command === "export-tgz" ||
  command === "import-tgz"
) {
  runCliCommand(command, args.slice(1)).catch((err: Error) => {
    console.error(`\n  ${err.message}`);
    process.exit(1);
  });
} else if (command === "--help" || command === "-h") {
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
  relay export <output-dir>
  relay import <bundle-dir>
  relay export-tgz <archive.tgz>
  relay import-tgz <archive.tgz>

Options:
  --port <number>     Server port (default: 7777)
  --password <string> Require password for authentication
  --tunnel            Expose via cloudflared tunnel

Notes:
  - When no password is set, the server runs in open mode (no login required).
    Set a password if you plan to expose the server over a tunnel or network.
  - export/import use a directory bundle with manifest + DB snapshot + transcript files
  - export-tgz/import-tgz wrap the same bundle format in a .tgz archive
  - import merges transcripts into local ~/.claude / ~/.codex by default`);
}

async function runCliCommand(commandName: string | undefined, args: string[]): Promise<void> {
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
}
