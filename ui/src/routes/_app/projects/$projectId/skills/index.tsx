import { createFileRoute } from "@tanstack/react-router";
import { SkillsPage } from "../../../../../pages/skills-page";

export const Route = createFileRoute("/_app/projects/$projectId/skills/")({
  component: SkillsPage,
});
