import type { RequestContext, Route } from "./types.js";

interface Router {
  handle(ctx: RequestContext): Promise<boolean>;
}

export function createRouter(routes: Route[]): Router {
  return {
    async handle(ctx: RequestContext): Promise<boolean> {
      for (const route of routes) {
        if (ctx.method !== route.method) {
          continue;
        }
        const match = ctx.pathname.match(route.pattern);
        if (!match) {
          continue;
        }
        await route.handler(ctx, match);
        return true;
      }
      return false;
    },
  };
}
