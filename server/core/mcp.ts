import type {
  ProviderKind,
  ProviderMcpConnectionState,
  ProviderMcpServerStatus,
} from "#core/types.js";

export function normalizeMcpConnectionState(
  status?: string,
  authStatus?: string,
  connected?: boolean,
): ProviderMcpConnectionState {
  const value = `${authStatus ?? ""} ${status ?? ""}`.toLowerCase();
  if (/needs.?auth|unauth|not.?authenticated|login|required|expired/.test(value))
    return "needs_auth";
  if (/fail|error|disconnected|not.?connected/.test(value)) return "failed";
  if (/disabled/.test(value)) return "disabled";
  if (/connecting|starting|pending/.test(value)) return "connecting";
  if (connected === true || /connected|authenticated|ready/.test(value)) return "connected";
  if (connected === false) return "failed";
  return "unknown";
}

export function normalizeMcpAuthentication(
  authStatus: string | undefined,
  connectionState: ProviderMcpConnectionState,
): ProviderMcpServerStatus["authentication"] {
  if (!authStatus) {
    return connectionState === "needs_auth"
      ? { method: "unknown", login: true, logout: false }
      : undefined;
  }
  const value = authStatus.toLowerCase().replace(/[^a-z]/g, "");
  if (value.includes("oauth")) {
    return { method: "oauth", login: true, logout: connectionState === "connected" };
  }
  if (value.includes("bearer") || value.includes("token")) {
    return { method: "bearer_token", login: false, logout: false };
  }
  if (value.includes("unsupported") || value === "none") {
    return { method: "none", login: false, logout: false };
  }
  if (connectionState === "needs_auth") {
    return { method: "unknown", login: true, logout: false };
  }
  if (value.includes("authenticated")) {
    return { method: "unknown", login: true, logout: true };
  }
  return { method: "unknown", login: false, logout: false };
}

export function mcpServerId(provider: ProviderKind, key: string): string {
  return `${provider}:${key}`;
}

export function overlayManagedMcpConfiguration(
  existing: ProviderMcpServerStatus[],
  provider: ProviderKind,
  name: string,
): ProviderMcpServerStatus[] {
  const id = mcpServerId(provider, name);
  const previous = existing.find((server) => server.id === id);
  return [
    ...existing.filter((server) => server.id !== id),
    {
      ...previous,
      id,
      name,
      provider,
      scope: "global",
      source: "relay",
      configured: true,
      connectionState: previous?.connectionState ?? "unknown",
    },
  ];
}

/** Merge Provider-global metadata with the servers reported for one Chat. */
export function resolveMcpServersForChat(
  provider: ProviderKind,
  globalServers: ProviderMcpServerStatus[] | undefined,
  chatServers: ProviderMcpServerStatus[] | undefined,
): ProviderMcpServerStatus[] | undefined {
  if (globalServers === undefined && chatServers === undefined) return undefined;
  const resolved = new Map<string, ProviderMcpServerStatus>();
  for (const server of globalServers ?? []) {
    if (server.provider === provider)
      resolved.set(server.id, { ...server, tools: server.tools?.map((tool) => ({ ...tool })) });
  }
  for (const server of chatServers ?? []) {
    if (server.provider !== provider) continue;
    const global = resolved.get(server.id);
    resolved.set(server.id, {
      ...global,
      ...server,
      configured: server.configured ?? global?.configured,
      available: server.available,
      connectionState:
        server.connectionState === "unknown" && global
          ? global.connectionState
          : server.connectionState,
      authentication: server.authentication ?? global?.authentication,
      tools:
        server.tools?.map((tool) => ({ ...tool })) ?? global?.tools?.map((tool) => ({ ...tool })),
    });
  }
  return [...resolved.values()];
}
