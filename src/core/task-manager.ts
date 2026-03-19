/**
 * Task Manager — JSONL-based task tracking for Relay projects.
 *
 * Tasks are stored in `.relay/tasks.jsonl` within a project directory.
 * The file is append-only: creates append new lines, updates append sparse
 * patches with the same ID, deletes append tombstones. Relay compacts
 * (deduplicates, strips tombstones) on every write.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { Task, TaskStatus, TaskType } from "./types.js";

const RELAY_DIR = ".relay";
const TASKS_FILE = "tasks.jsonl";

function tasksPath(dir: string): string {
  return join(dir, RELAY_DIR, TASKS_FILE);
}

function generateId(): string {
  return randomBytes(4).toString("hex");
}

// ---------------------------------------------------------------------------
// Read / materialize
// ---------------------------------------------------------------------------

/**
 * Parse the append-only JSONL file and materialize the current task state.
 * Deduplicates by ID (last-write-wins with sparse merge), strips tombstones,
 * and derives `blocked` status from unresolved `blockedBy` references.
 */
export function loadTasks(dir: string): Task[] {
  const fp = tasksPath(dir);
  if (!existsSync(fp)) return [];

  const raw = readFileSync(fp, "utf-8").trim();
  if (!raw) return [];

  // Sparse merge: accumulate fields per ID, last write wins per field
  const entries = new Map<string, Record<string, unknown>>();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const id = obj.id as string;
      if (!id) continue;
      const existing = entries.get(id);
      if (existing) {
        // Merge: new fields override old, but keep unset fields from previous
        for (const [k, v] of Object.entries(obj)) {
          existing[k] = v;
        }
      } else {
        entries.set(id, { ...obj });
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Strip tombstones
  const live: Task[] = [];
  for (const obj of entries.values()) {
    if (obj.deleted) continue;
    live.push(obj as unknown as Task);
  }

  // Derive blocked status: if any blockedBy ID references a non-done task,
  // override status to "blocked"
  const taskMap = new Map(live.map((t) => [t.id, t]));
  for (const task of live) {
    if (task.status === "done") continue;
    if (task.blockedBy && task.blockedBy.length > 0) {
      const hasUnresolvedBlocker = task.blockedBy.some((bid) => {
        const blocker = taskMap.get(bid);
        return blocker && blocker.status !== "done";
      });
      if (hasUnresolvedBlocker) {
        task.status = "blocked";
      } else if (task.status === "blocked") {
        // All blockers resolved — revert to open
        task.status = "open";
      }
    }
  }

  return live;
}

// ---------------------------------------------------------------------------
// Write / compact
// ---------------------------------------------------------------------------

/** Write compacted tasks to disk (temp file + rename for atomicity). */
function saveTasks(dir: string, tasks: Task[]): void {
  const fp = tasksPath(dir);
  const relayDir = join(dir, RELAY_DIR);
  if (!existsSync(relayDir)) mkdirSync(relayDir, { recursive: true });

  const lines = tasks.map((t) => {
    // Strip the derived blocked status — store the "real" status
    // so blocked can be re-derived on next load
    const stored = { ...t };
    if (stored.deleted) return JSON.stringify(stored);
    return JSON.stringify(stored);
  });
  const content = lines.join("\n") + "\n";

  const tmp = fp + ".tmp." + process.pid;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, fp);
}

/** Append a single JSON line to the tasks file. */
function appendLine(dir: string, obj: Record<string, unknown>): void {
  const fp = tasksPath(dir);
  const relayDir = join(dir, RELAY_DIR);
  if (!existsSync(relayDir)) mkdirSync(relayDir, { recursive: true });

  appendFileSync(fp, JSON.stringify(obj) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: number;
  type?: TaskType;
  tags?: string[];
  parent?: string | null;
  blockedBy?: string[];
}

/** Create a new task. Appends to the file, compacts, returns the created task. */
export function createTask(dir: string, input: CreateTaskInput): Task {
  const now = new Date().toISOString();
  const task: Task = {
    id: generateId(),
    title: input.title,
    description: input.description ?? "",
    status: "open",
    priority: input.priority ?? 2,
    type: input.type ?? "task",
    tags: input.tags ?? [],
    parent: input.parent ?? null,
    blockedBy: input.blockedBy ?? [],
    createdAt: now,
    updatedAt: now,
  };

  appendLine(dir, task as unknown as Record<string, unknown>);

  // Compact to materialize and validate
  const tasks = loadTasks(dir);
  saveTasks(dir, tasks);
  return tasks.find((t) => t.id === task.id)!;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: number;
  type?: TaskType;
  tags?: string[];
  parent?: string | null;
  blockedBy?: string[];
}

/** Update an existing task. Validates constraints, appends sparse patch, compacts. */
export function updateTask(dir: string, taskId: string, patch: UpdateTaskInput): Task {
  const tasks = loadTasks(dir);
  const existing = tasks.find((t) => t.id === taskId);
  if (!existing) throw new Error(`Task ${taskId} not found`);

  // Validate: can't complete a parent with open children
  if (patch.status === "done") {
    const openChildren = tasks.filter((t) => t.parent === taskId && t.status !== "done");
    if (openChildren.length > 0) {
      const childList = openChildren.map((c) => `${c.id} ("${c.title}")`).join(", ");
      throw new Error(
        `Cannot complete task ${taskId}: open children must be addressed first: ${childList}`,
      );
    }
  }

  // Append sparse update
  const update: Record<string, unknown> = { id: taskId, updatedAt: new Date().toISOString() };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) update[k] = v;
  }
  appendLine(dir, update);

  // Compact and return
  const updated = loadTasks(dir);
  saveTasks(dir, updated);
  return updated.find((t) => t.id === taskId)!;
}

/** Delete a task. Orphans children, cleans blockedBy refs, appends tombstone, compacts. */
export function deleteTask(dir: string, taskId: string): void {
  const tasks = loadTasks(dir);
  const existing = tasks.find((t) => t.id === taskId);
  if (!existing) throw new Error(`Task ${taskId} not found`);

  // Orphan children and clean blockedBy references
  const patches: Record<string, unknown>[] = [];
  const now = new Date().toISOString();

  for (const task of tasks) {
    if (task.parent === taskId) {
      patches.push({ id: task.id, parent: null, updatedAt: now });
    }
    if (task.blockedBy?.includes(taskId)) {
      patches.push({
        id: task.id,
        blockedBy: task.blockedBy.filter((b) => b !== taskId),
        updatedAt: now,
      });
    }
  }

  // Append all patches + tombstone
  for (const p of patches) appendLine(dir, p);
  appendLine(dir, { id: taskId, deleted: true, updatedAt: now });

  // Compact
  const updated = loadTasks(dir);
  saveTasks(dir, updated);
}

// ---------------------------------------------------------------------------
// Init / query
// ---------------------------------------------------------------------------

/** Check if a project has a tasks file. */
export function hasTasks(dir: string): boolean {
  return existsSync(tasksPath(dir));
}

/** Initialize the .relay directory and empty tasks file. */
export function initTasks(dir: string): void {
  const relayDir = join(dir, RELAY_DIR);
  if (!existsSync(relayDir)) mkdirSync(relayDir, { recursive: true });
  const fp = tasksPath(dir);
  if (!existsSync(fp)) writeFileSync(fp, "", "utf-8");
}

/** CLAUDE.md snippet describing the task format for models. */
export const TASKS_CLAUDE_MD_SNIPPET = `## Tasks

Tasks tracked in \`.relay/tasks.jsonl\` (append-only JSONL). Read this file for open tasks.
Do not create a task for every request. Create a task only when explicitly asked, pick up an existing task when explicitly asked or when the request clearly matches one, and otherwise just do the work without creating a new task. If unsure whether a request should map to a task, ask.
Update by appending a JSON line with the task \`id\` and changed fields.
Fields: id, title, description, status (open|in_progress|done), priority (0-4), type (epic|task|bug), tags, parent, blockedBy, createdAt, updatedAt.`;

// ---------------------------------------------------------------------------
// Migration from beads
// ---------------------------------------------------------------------------

interface BeadsDep {
  issue_id: string;
  depends_on_id: string;
  type?: string;
  created_at?: string;
  created_by?: string;
}

interface BeadsEntry {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  issue_type: string;
  owner?: string;
  created_at: string;
  updated_at: string;
  dependencies?: BeadsDep[];
  dependents?: BeadsDep[];
}

/** Migrate tasks from .beads/issues.jsonl to .relay/tasks.jsonl. */
export function migrateFromBeads(dir: string): Task[] {
  const beadsFile = join(dir, ".beads", "issues.jsonl");
  if (!existsSync(beadsFile)) {
    throw new Error("No .beads/issues.jsonl found in " + dir);
  }

  const raw = readFileSync(beadsFile, "utf-8").trim();
  if (!raw) return [];

  const entries: BeadsEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as BeadsEntry);
    } catch {
      // skip
    }
  }

  // Build ID mapping: beads IDs can be long UUIDs — take last 8 chars or generate new
  const idMap = new Map<string, string>();
  const usedIds = new Set<string>();
  for (const entry of entries) {
    let shortId = entry.id.replace(/-/g, "").slice(-8);
    if (usedIds.has(shortId)) shortId = generateId();
    usedIds.add(shortId);
    idMap.set(entry.id, shortId);
  }

  function mapStatus(s: string): TaskStatus {
    if (s === "closed" || s === "done") return "done";
    if (s === "in_progress") return "in_progress";
    if (s === "blocked") return "blocked";
    // deferred, open, anything else → open
    return "open";
  }

  function mapType(t: string): TaskType {
    if (t === "epic") return "epic";
    if (t === "bug") return "bug";
    return "task";
  }

  const tasks: Task[] = entries.map((e) => {
    // Extract parent from dependencies with type "parent-child"
    const parentDep = e.dependencies?.find((d) => d.type === "parent-child");
    const blockers = (e.dependencies ?? [])
      .filter((d) => d.type !== "parent-child")
      .map((d) => idMap.get(d.depends_on_id))
      .filter((id): id is string => !!id);

    return {
      id: idMap.get(e.id)!,
      title: e.title,
      description: e.description ?? "",
      status: mapStatus(e.status),
      priority: e.priority ?? 2,
      type: mapType(e.issue_type),
      tags: [],
      parent: parentDep ? (idMap.get(parentDep.depends_on_id) ?? null) : null,
      blockedBy: blockers,
      createdAt: e.created_at,
      updatedAt: e.updated_at,
    };
  });

  // Write to .relay/tasks.jsonl
  initTasks(dir);
  saveTasks(dir, tasks);
  return tasks;
}
