/**
 * Claude Code CLI Utilities
 *
 * Binary discovery and installation detection for the Claude Code CLI.
 * Used by provider-registry.ts to determine if the Claude provider is available.
 */

import { execSync } from "child_process";

let cachedClaudeBinary: string | null | undefined;

export function findClaudeBinary(): string | null {
  if (cachedClaudeBinary !== undefined) return cachedClaudeBinary;

  const candidates = [
    `${process.env.HOME}/.local/bin/claude`,
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ];

  for (const candidate of candidates) {
    try {
      if (execSync(`test -x "${candidate}" && echo ok`, { encoding: "utf-8" }).trim() === "ok") {
        cachedClaudeBinary = candidate;
        return cachedClaudeBinary;
      }
    } catch {
      // ignore and continue
    }
  }

  try {
    const result = execSync("which claude", { encoding: "utf-8" }).trim();
    if (result) {
      cachedClaudeBinary = result;
      return cachedClaudeBinary;
    }
  } catch {
    // ignore
  }

  cachedClaudeBinary = null;
  return cachedClaudeBinary;
}

export function isClaudeInstalled(): boolean {
  return findClaudeBinary() !== null;
}
