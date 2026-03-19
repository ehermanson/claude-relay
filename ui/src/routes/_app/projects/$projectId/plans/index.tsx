import { createFileRoute } from "@tanstack/react-router";
import { PlansPage } from "@/pages/plans-page";
import { validatePlansSearch } from "@/routes/_app/projects/$projectId/plans/-search";

export const Route = createFileRoute("/_app/projects/$projectId/plans/")({
  component: PlansPage,
  validateSearch: validatePlansSearch,
});
