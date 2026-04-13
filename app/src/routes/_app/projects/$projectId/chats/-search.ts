interface ChatRouteSearch {
  split?: string;
  q?: string;
  match?: string;
}

export function validateChatSearch(search: Record<string, unknown>): ChatRouteSearch {
  return {
    split: typeof search.split === "string" ? search.split : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
    match: typeof search.match === "string" ? search.match : undefined,
  };
}
