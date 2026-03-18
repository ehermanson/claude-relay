#!/usr/bin/env npx tsx
/**
 * One-off migration script: .beads/issues.jsonl → .relay/tasks.jsonl
 *
 * Usage:
 *   npx tsx scripts/migrate-beads.ts /path/to/project
 *   npx tsx scripts/migrate-beads.ts  # uses cwd
 */

import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { migrateFromBeads } from "../src/core/task-manager.js";

const dir = resolve(process.argv[2] || process.cwd());

if (!existsSync(resolve(dir, ".beads", "issues.jsonl"))) {
  console.error(`No .beads/issues.jsonl found in ${dir}`);
  process.exit(1);
}

if (existsSync(resolve(dir, ".relay", "tasks.jsonl"))) {
  console.error(`.relay/tasks.jsonl already exists in ${dir} — aborting to avoid overwrite`);
  process.exit(1);
}

const tasks = migrateFromBeads(dir);
console.log(`Migrated ${tasks.length} tasks from .beads/ to .relay/tasks.jsonl`);
for (const t of tasks) {
  console.log(`  ${t.id}  [${t.status.padEnd(11)}]  ${t.type.padEnd(5)}  ${t.title}`);
}
