/**
 * Shared test environment setup.
 *
 * Redirects RELAY_WORKTREE_BASE to a temp directory so tests never
 * pollute ~/.relay/worktrees. Cleans up the temp dir on process exit.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const inheritedWorktreeBase = process.env.RELAY_WORKTREE_BASE;
const shouldIsolateWorktreeBase =
  !inheritedWorktreeBase || inheritedWorktreeBase.includes("relay-test-worktrees-");

if (shouldIsolateWorktreeBase) {
  process.env.RELAY_WORKTREE_BASE = mkdtempSync(join(tmpdir(), "relay-test-worktrees-"));
}

export const TEST_WORKTREE_BASE = process.env.RELAY_WORKTREE_BASE;

// Keep git-dependent tests deterministic and avoid inheriting slow global config
// like LFS filters, signing hooks, or interactive prompts from the host machine.
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_TERMINAL_PROMPT = "0";
process.env.GIT_ASKPASS = "true";
process.env.GIT_LFS_SKIP_SMUDGE = "1";
process.env.RELAY_GIT_TIMEOUT_MS = process.env.RELAY_GIT_TIMEOUT_MS || "5000";
process.env.GIT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME || "Relay Test";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL || "relay-test@example.com";
process.env.GIT_COMMITTER_NAME = process.env.GIT_COMMITTER_NAME || process.env.GIT_AUTHOR_NAME;
process.env.GIT_COMMITTER_EMAIL = process.env.GIT_COMMITTER_EMAIL || process.env.GIT_AUTHOR_EMAIL;

process.on("exit", () => {
  try {
    rmSync(TEST_WORKTREE_BASE, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});
