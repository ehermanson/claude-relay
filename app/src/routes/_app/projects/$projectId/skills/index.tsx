import { lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";

const SkillsPage = lazy(() =>
  import("@/pages/skills-page").then((m) => ({ default: m.SkillsPage })),
);

export const Route = createFileRoute("/_app/projects/$projectId/skills/")({
  component: SkillsPage,
});
