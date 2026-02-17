/**
 * Cloudflare Tunnel management for Claude Relay
 *
 * Extracted from bin.ts for reuse.
 */

import { spawn, type ChildProcess } from "child_process";

let tunnelProcess: ChildProcess | null = null;

/**
 * Start a cloudflared quick tunnel pointing at the given local port.
 * The tunnel URL is printed to stdout when discovered.
 */
export function startTunnel(localPort: number): void {
  console.log("  Starting cloudflared tunnel...");

  tunnelProcess = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${localPort}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  tunnelProcess.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error(
        "\n  cloudflared not found. Install it:\n" +
          "    brew install cloudflared        (macOS)\n" +
          "    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n",
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

/**
 * Stop the running tunnel process, if any.
 */
export function stopTunnel(): void {
  if (tunnelProcess) {
    tunnelProcess.kill();
    tunnelProcess = null;
  }
}
