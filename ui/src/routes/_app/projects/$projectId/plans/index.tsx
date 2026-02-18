import { createFileRoute } from "@tanstack/react-router";
import { PlansPage } from "../../../../../pages/plans-page";

export const Route = createFileRoute("/_app/projects/$projectId/plans/")({
  component: PlansPage,
});
