import { createFileRoute } from "@tanstack/react-router";
import { PlanPage } from "../../../../../pages/plan-page";

export const Route = createFileRoute("/_app/projects/$projectId/plans/$planSlug")({
  component: PlanPage,
});
