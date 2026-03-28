import { createFileRoute } from "@tanstack/react-router";
import { ProjectPage } from "../../../../pages/project-page";

export const Route = createFileRoute("/_app/projects/$projectId/")({
  component: ProjectPage,
});
