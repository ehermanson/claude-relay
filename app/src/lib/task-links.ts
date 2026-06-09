import type { Task } from "@shared/types";

export function buildTaskReference(task: Pick<Task, "id" | "title">): string {
  return `@task:${task.id}:${encodeURIComponent(task.title)} `;
}
