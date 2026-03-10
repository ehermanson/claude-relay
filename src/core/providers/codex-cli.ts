/**
 * Codex CLI Utilities
 *
 * Binary discovery and installation detection for the Codex CLI.
 * Used by codex-app-server.ts and codex-models.ts.
 */

import { execSync } from "child_process";

export function findCodexBinary(): string | null {
  const candidates = [
    `${process.env.HOME}/.local/bin/codex`,
    "/usr/local/bin/codex",
    "/opt/homebrew/bin/codex",
  ];

  for (const candidate of candidates) {
    try {
      if (execSync(`test -x "${candidate}" && echo ok`, { encoding: "utf-8" }).trim() === "ok") {
        return candidate;
      }
    } catch {
      // ignore and continue
    }
  }

  try {
    const result = execSync("which codex", { encoding: "utf-8" }).trim();
    if (result) return result;
  } catch {
    // ignore
  }

  return null;
}

export function isCodexInstalled(): boolean {
  return findCodexBinary() !== null;
}
