import { createFileRoute } from "@tanstack/react-router";
import { PlansPage } from "../../../../../pages/plans-page";

interface PlansSearch {
  plan?: string;
  sort?: string;
  q?: string;
}

export const Route = createFileRoute("/_app/projects/$projectId/plans/")({
  component: PlansPage,
  validateSearch: (search: Record<string, unknown>): PlansSearch => ({
    plan: typeof search.plan === "string" ? search.plan : undefined,
    sort: typeof search.sort === "string" ? search.sort : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
  }),
});
