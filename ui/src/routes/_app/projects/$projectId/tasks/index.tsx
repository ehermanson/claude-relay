import { createFileRoute } from "@tanstack/react-router";
import { TasksPage } from "../../../../../pages/tasks-page";

interface TasksSearch {
  task?: string;
  sort?: string;
}

export const Route = createFileRoute("/_app/projects/$projectId/tasks/")({
  component: TasksPage,
  validateSearch: (search: Record<string, unknown>): TasksSearch => ({
    task: typeof search.task === "string" ? search.task : undefined,
    sort: typeof search.sort === "string" ? search.sort : undefined,
  }),
});
