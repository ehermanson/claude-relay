import { createFileRoute } from "@tanstack/react-router";
import { TasksPage } from "@/pages/tasks-page";
import { validateTasksSearch } from "@/routes/_app/projects/$projectId/tasks/-search";

export const Route = createFileRoute("/_app/projects/$projectId/tasks/")({
  component: TasksPage,
  validateSearch: validateTasksSearch,
});
