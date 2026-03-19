import type { Session } from "../../core/types.js";
import type { RequestContext } from "./types.js";
import { sendJson } from "./respond.js";

export function requireAuth(ctx: RequestContext): Session | null {
  if (!ctx.isAuthenticated) {
    sendJson(ctx.res, 401, { error: "Unauthorized" });
    return null;
  }
  return ctx.session;
}
