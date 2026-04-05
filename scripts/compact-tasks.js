#!/usr/bin/env node
/**
 * Compact .relay/tasks.jsonl — deduplicate to one canonical line per task.
 *
 * Later lines with the same `id` are merged into earlier ones (last write wins
 * per field). The output preserves insertion order (by first appearance of each id).
 *
 * Usage:
 *   node scripts/compact-tasks.js            # compacts in place
 *   node scripts/compact-tasks.js --check    # exits 1 if file would change (CI)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TASKS_PATH = resolve(import.meta.dirname, "..", ".relay", "tasks.jsonl");
const check = process.argv.includes("--check");

const raw = readFileSync(TASKS_PATH, "utf8").trimEnd();
if (!raw) process.exit(0);

const lines = raw.split("\n");

/** @type {Map<string, object>} id → merged task object */
const tasks = new Map();
/** @type {string[]} insertion-order ids */
const order = [];

for (const line of lines) {
  const obj = JSON.parse(line);
  const id = obj.id;
  if (tasks.has(id)) {
    // Merge: later fields overwrite earlier ones
    tasks.set(id, { ...tasks.get(id), ...obj });
  } else {
    order.push(id);
    tasks.set(id, obj);
  }
}

const compacted = order.map((id) => JSON.stringify(tasks.get(id))).join("\n") + "\n";

if (compacted === raw + "\n") {
  // Already compact
  process.exit(0);
}

if (check) {
  const before = lines.length;
  const after = order.length;
  console.error(`tasks.jsonl needs compaction: ${before} lines → ${after} tasks`);
  process.exit(1);
}

writeFileSync(TASKS_PATH, compacted);

const removed = lines.length - order.length;
if (removed > 0) {
  console.log(
    `Compacted tasks.jsonl: ${lines.length} → ${order.length} lines (${removed} redundant)`,
  );
}
