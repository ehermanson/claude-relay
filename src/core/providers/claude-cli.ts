/**
 * Claude Code CLI Utilities
 *
 * Binary discovery and installation detection for the Claude Code CLI.
 * Used by provider-registry.ts to determine if the Claude provider is available.
 */

import { execSync } from "child_process";

export function findClaudeBinary(): string | null {
  const candidates = [
    `${process.env.HOME}/.local/bin/claude`,
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
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
    const result = execSync("which claude", { encoding: "utf-8" }).trim();
    if (result) return result;
  } catch {
    // ignore
  }

  return null;
}

export function isClaudeInstalled(): boolean {
  return findClaudeBinary() !== null;
}
