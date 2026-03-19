export interface ChatRouteSearch {
  split?: string;
}

export function validateChatSearch(search: Record<string, unknown>): ChatRouteSearch {
  return {
    split: typeof search.split === "string" ? search.split : undefined,
  };
}
