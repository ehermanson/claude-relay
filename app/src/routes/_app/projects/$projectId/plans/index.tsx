import { lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { validatePlansSearch } from "@/routes/_app/projects/$projectId/plans/-search";

const PlansPage = lazy(() => import("@/pages/plans-page").then((m) => ({ default: m.PlansPage })));

export const Route = createFileRoute("/_app/projects/$projectId/plans/")({
  component: PlansPage,
  validateSearch: validatePlansSearch,
});
