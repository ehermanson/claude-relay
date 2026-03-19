import http from "node:http";
import type { AuthManager } from "../auth.js";
import type { RequestContext } from "./types.js";

export function createRequestContext(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  auth: AuthManager,
): RequestContext {
  const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const session = auth.getSessionFromCookies(req.headers.cookie);

  return {
    req,
    res,
    method: req.method || "GET",
    parsedUrl,
    pathname: parsedUrl.pathname,
    session,
    isAuthenticated: session !== null,
  };
}
