/**
 * Shared test environment setup.
 *
 * Redirects RELAY_WORKTREE_BASE to a temp directory so tests never
 * pollute ~/.relay/worktrees. Cleans up the temp dir on process exit.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

if (!process.env.RELAY_WORKTREE_BASE) {
  process.env.RELAY_WORKTREE_BASE = mkdtempSync(join(tmpdir(), "relay-test-worktrees-"));
}

export const TEST_WORKTREE_BASE = process.env.RELAY_WORKTREE_BASE;

process.on("exit", () => {
  try {
    rmSync(TEST_WORKTREE_BASE, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});
