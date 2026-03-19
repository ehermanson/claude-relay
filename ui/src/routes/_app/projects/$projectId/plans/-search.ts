export interface PlansRouteSearch {
  plan?: string;
  sort?: string;
  q?: string;
}

export function validatePlansSearch(search: Record<string, unknown>): PlansRouteSearch {
  return {
    plan: typeof search.plan === "string" ? search.plan : undefined,
    sort: typeof search.sort === "string" ? search.sort : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
  };
}

export function patchPlansSearch(patch: Partial<PlansRouteSearch>) {
  return (prev: PlansRouteSearch): PlansRouteSearch => ({
    ...prev,
    ...patch,
  });
}

export function togglePlanSearch(plan: string) {
  return (prev: PlansRouteSearch): PlansRouteSearch => ({
    ...prev,
    plan: prev.plan === plan ? undefined : plan,
  });
}
