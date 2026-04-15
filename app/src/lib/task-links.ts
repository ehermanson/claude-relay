import type { HistoryEntry, Task } from "@shared/types";

const TASK_REF_RE = /@task:([a-f0-9]{8})(?::[^\s@]*)?\b/g;

export function buildTaskReference(task: Pick<Task, "id" | "title">): string {
  return `@task:${task.id}:${encodeURIComponent(task.title)} `;
}

export function extractTaskIdsFromText(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(TASK_REF_RE)) {
    const taskId = match[1];
    if (!taskId || seen.has(taskId)) continue;
    seen.add(taskId);
    ids.push(taskId);
  }

  return ids;
}

export function extractTaskIdsFromHistory(history: HistoryEntry[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const entry of history) {
    if (entry.message.type !== "user" || !entry.message.text) continue;
    for (const taskId of extractTaskIdsFromText(entry.message.text)) {
      if (seen.has(taskId)) continue;
      seen.add(taskId);
      ids.push(taskId);
    }
  }

  return ids;
}

export function extractPrimaryTaskIdFromHistory(history: HistoryEntry[]): string | null {
  return extractTaskIdsFromHistory(history)[0] ?? null;
}
