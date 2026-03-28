import { lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { validateTasksSearch } from "@/routes/_app/projects/$projectId/tasks/-search";

const TasksPage = lazy(() => import("@/pages/tasks-page").then((m) => ({ default: m.TasksPage })));

export const Route = createFileRoute("/_app/projects/$projectId/tasks/")({
  component: TasksPage,
  validateSearch: validateTasksSearch,
});
