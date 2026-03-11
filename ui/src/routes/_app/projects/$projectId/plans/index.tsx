import { createFileRoute } from "@tanstack/react-router";
import { PlansPage } from "../../../../../pages/plans-page";

interface PlansSearch {
  plan?: string;
}

export const Route = createFileRoute("/_app/projects/$projectId/plans/")({
  component: PlansPage,
  validateSearch: (search: Record<string, unknown>): PlansSearch => ({
    plan: typeof search.plan === "string" ? search.plan : undefined,
  }),
});
