/**
 * Task Manager — snapshot-based task tracking for Relay projects.
 *
 * Canonical task state lives in `.relay/tasks.json` within a project directory.
 * Relay writes the full snapshot atomically via temp file + rename.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { Task, TaskStatus, TaskType } from "#core/types.js";

const RELAY_DIR = ".relay";
const TASKS_FILE = "tasks.json";
const TASKS_SCHEMA_VERSION = 1;

interface TaskSnapshot {
  version: number;
  tasks: Task[];
}

function tasksPath(dir: string): string {
  return join(dir, RELAY_DIR, TASKS_FILE);
}

function ensureRelayDir(dir: string): string {
  const relayDir = join(dir, RELAY_DIR);
  if (!existsSync(relayDir)) mkdirSync(relayDir, { recursive: true });
  return relayDir;
}

function generateId(): string {
  return randomBytes(4).toString("hex");
}

function isTaskType(value: unknown): value is TaskType {
  return value === "epic" || value === "task" || value === "bug";
}

function isStoredTaskStatus(value: unknown): value is Exclude<TaskStatus, "blocked"> {
  return value === "open" || value === "in_progress" || value === "done";
}

function normalizeTask(raw: Record<string, unknown>): Task {
  const fallbackCreatedAt = new Date(0).toISOString();
  const createdAt =
    typeof raw.createdAt === "string" && raw.createdAt.trim() ? raw.createdAt : fallbackCreatedAt;
  const updatedAt =
    typeof raw.updatedAt === "string" && raw.updatedAt.trim() ? raw.updatedAt : createdAt;
  if (typeof raw.id !== "string" || !/^[a-f0-9]{8}$/.test(raw.id)) {
    throw new Error("Invalid task id in .relay/tasks.json");
  }

  return {
    id: raw.id,
    title: typeof raw.title === "string" ? raw.title : "",
    description: typeof raw.description === "string" ? raw.description : "",
    status: isStoredTaskStatus(raw.status) ? raw.status : "open",
    priority: typeof raw.priority === "number" ? raw.priority : 2,
    type: isTaskType(raw.type) ? raw.type : "task",
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    parent: typeof raw.parent === "string" && /^[a-f0-9]{8}$/.test(raw.parent) ? raw.parent : null,
    blockedBy: Array.isArray(raw.blockedBy)
      ? raw.blockedBy.filter(
          (id): id is string => typeof id === "string" && /^[a-f0-9]{8}$/.test(id),
        )
      : [],
    createdAt,
    updatedAt,
  };
}

function cloneTask(task: Task): Task {
  return {
    ...task,
    tags: [...task.tags],
    blockedBy: [...task.blockedBy],
  };
}

function deriveBlockedStatus(tasks: Task[]): Task[] {
  const live = tasks.map(cloneTask);
  const taskMap = new Map(live.map((task) => [task.id, task]));

  for (const task of live) {
    if (task.status === "done") continue;
    if (task.blockedBy.length === 0) {
      if (task.status === "blocked") task.status = "open";
      continue;
    }
    const hasUnresolvedBlocker = task.blockedBy.some((blockerId) => {
      const blocker = taskMap.get(blockerId);
      return blocker && blocker.status !== "done";
    });
    if (hasUnresolvedBlocker) {
      task.status = "blocked";
    } else if (task.status === "blocked") {
      task.status = "open";
    }
  }

  return live;
}

function toStoredTask(task: Task): Task {
  const stored = cloneTask(task);
  if (stored.status === "blocked") stored.status = "open";
  return stored;
}

function normalizeTasksSafely(rawTasks: unknown[]): Task[] {
  const tasks: Task[] = [];
  for (const value of rawTasks) {
    if (!value || typeof value !== "object") continue;
    try {
      tasks.push(normalizeTask(value as Record<string, unknown>));
    } catch (err) {
      // Skip a single malformed task rather than discarding the entire list — one
      // bad entry (e.g. an agent-authored non-hex id) must not blank out the UI.
      console.warn(
        `Skipping malformed task in .relay/tasks.json: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return tasks;
}

function loadStoredTasks(dir: string): Task[] {
  const filePath = tasksPath(dir);
  if (!existsSync(filePath)) return [];

  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return normalizeTasksSafely(parsed);
    }

    if (parsed && typeof parsed === "object") {
      const snapshot = parsed as Partial<TaskSnapshot> & { tasks?: unknown };
      if (Array.isArray(snapshot.tasks)) {
        return normalizeTasksSafely(snapshot.tasks as unknown[]);
      }
    }
  } catch {
    return [];
  }

  return [];
}

function writeTaskSnapshot(dir: string, tasks: Task[]): void {
  ensureRelayDir(dir);
  const filePath = tasksPath(dir);
  const snapshot: TaskSnapshot = {
    version: TASKS_SCHEMA_VERSION,
    tasks: tasks.map(toStoredTask),
  };
  const content = JSON.stringify(snapshot) + "\n";
  const tmpPath = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmpPath, content, "utf8");
  renameSync(tmpPath, filePath);
}

function currentTasks(dir: string): Task[] {
  return deriveBlockedStatus(loadStoredTasks(dir));
}

export function loadTasks(dir: string): Task[] {
  return currentTasks(dir);
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: number;
  type?: TaskType;
  tags?: string[];
  parent?: string | null;
  blockedBy?: string[];
}

export function createTask(dir: string, input: CreateTaskInput): Task {
  const tasks = loadStoredTasks(dir);
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

  tasks.push(task);
  writeTaskSnapshot(dir, tasks);
  return loadTasks(dir).find((existing) => existing.id === task.id)!;
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

export function updateTask(dir: string, taskId: string, patch: UpdateTaskInput): Task {
  const tasks = loadStoredTasks(dir);
  const current = deriveBlockedStatus(tasks);
  const existing = current.find((task) => task.id === taskId);
  if (!existing) throw new Error(`Task ${taskId} not found`);

  if (patch.status === "done") {
    const openChildren = current.filter((task) => task.parent === taskId && task.status !== "done");
    if (openChildren.length > 0) {
      const childList = openChildren.map((child) => `${child.id} ("${child.title}")`).join(", ");
      throw new Error(
        `Cannot complete task ${taskId}: open children must be addressed first: ${childList}`,
      );
    }
  }

  const index = tasks.findIndex((task) => task.id === taskId);
  const base = tasks[index];
  if (!base) throw new Error(`Task ${taskId} not found`);

  tasks[index] = {
    ...base,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.type !== undefined ? { type: patch.type } : {}),
    ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
    ...(patch.parent !== undefined ? { parent: patch.parent } : {}),
    ...(patch.blockedBy !== undefined ? { blockedBy: patch.blockedBy } : {}),
    updatedAt: new Date().toISOString(),
  };

  writeTaskSnapshot(dir, tasks);
  return loadTasks(dir).find((task) => task.id === taskId)!;
}

export function deleteTask(dir: string, taskId: string): void {
  const tasks = loadStoredTasks(dir);
  const existing = tasks.find((task) => task.id === taskId);
  if (!existing) throw new Error(`Task ${taskId} not found`);

  const now = new Date().toISOString();
  const nextTasks = tasks
    .filter((task) => task.id !== taskId)
    .map((task) => {
      let changed = false;
      const next = cloneTask(task);

      if (next.parent === taskId) {
        next.parent = null;
        changed = true;
      }

      if (next.blockedBy.includes(taskId)) {
        next.blockedBy = next.blockedBy.filter((blockerId) => blockerId !== taskId);
        changed = true;
      }

      if (changed) next.updatedAt = now;
      return next;
    });

  writeTaskSnapshot(dir, nextTasks);
}

export function hasTasks(dir: string): boolean {
  return existsSync(tasksPath(dir));
}

export function initTasks(dir: string): void {
  ensureRelayDir(dir);
  if (!existsSync(tasksPath(dir))) writeTaskSnapshot(dir, []);
}

export const TASKS_CLAUDE_MD_SNIPPET = `## Tasks

Tasks tracked in \`.relay/tasks.json\` as Relay-managed snapshot state. Read this file for open tasks.
Do not create a task for every request. Create a task only when explicitly asked, pick up an existing task when explicitly asked or when the request clearly matches one, and otherwise just do the work without creating a new task. If unsure whether a request should map to a task, ask.
Update the snapshot in place when task state changes.
Fields: id (8-char hex), title, description, status (open|in_progress|done; blocked is derived from blockedBy), priority (0-4), type (epic|task|bug), tags, parent, blockedBy, createdAt, updatedAt.`;
