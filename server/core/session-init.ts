import { mcpServerId, normalizeMcpAuthentication, normalizeMcpConnectionState } from "#core/mcp.js";
import type { ProviderKind, ProviderMcpServerStatus, SystemEventMessage } from "#core/types.js";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function normalizeStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return items.length > 0 ? items : undefined;
}

function normalizeSlashCommandList(value: unknown):
  | Array<{
      name: string;
      description?: string;
      input?: { hint?: string };
    }>
  | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((item) => {
    if (typeof item === "string" && item.trim().length > 0) {
      return [{ name: item.trim() }];
    }
    const record = asRecord(item);
    if (!record || typeof record.name !== "string" || !record.name.trim()) return [];
    const argumentHint =
      typeof record.argumentHint === "string"
        ? record.argumentHint
        : typeof record.hint === "string"
          ? record.hint
          : undefined;
    return [
      {
        name: record.name.trim(),
        description:
          typeof record.description === "string" && record.description.trim()
            ? record.description.trim()
            : undefined,
        input:
          typeof argumentHint === "string" && argumentHint.trim()
            ? { hint: argumentHint.trim() }
            : undefined,
      },
    ];
  });
  return items.length > 0 ? items : undefined;
}

function normalizeSkillList(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) {
      return [{ name: item.trim() }];
    }
    const record = asRecord(item);
    if (!record || typeof record.name !== "string" || !record.name.trim()) return [];
    return [
      {
        name: record.name.trim(),
        ...(typeof record.description === "string" && record.description.trim()
          ? { description: record.description.trim() }
          : {}),
        ...(typeof record.shortDescription === "string" && record.shortDescription.trim()
          ? { shortDescription: record.shortDescription.trim() }
          : {}),
        ...(typeof record.displayName === "string" && record.displayName.trim()
          ? { displayName: record.displayName.trim() }
          : {}),
        ...(typeof record.path === "string" && record.path.trim()
          ? { path: record.path.trim() }
          : {}),
        ...(record.invocationPrefix === "/" || record.invocationPrefix === "$"
          ? { invocationPrefix: record.invocationPrefix }
          : {}),
        ...(typeof record.enabled === "boolean" ? { enabled: record.enabled } : {}),
      },
    ];
  });
  return items.length > 0 ? items : undefined;
}

function normalizeAgents(value: unknown): Array<string | JsonRecord> | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string | JsonRecord => {
    if (typeof item === "string") return item.trim().length > 0;
    const record = asRecord(item);
    return !!record && typeof record.name === "string" && record.name.trim().length > 0;
  });
  return items.length > 0 ? items : undefined;
}

function normalizeMcpServers(
  value: unknown,
  provider: ProviderKind,
): ProviderMcpServerStatus[] | undefined {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => {
        if (typeof item === "string" && item.trim()) {
          return {
            id: mcpServerId(provider, item.trim()),
            name: item.trim(),
            provider,
            scope: "chat" as const,
            source: "provider" as const,
            available: true,
            connectionState: "unknown" as const,
          };
        }
        const record = asRecord(item);
        if (!record) return null;
        const name = typeof record.name === "string" ? record.name : undefined;
        if (!name?.trim()) return null;
        const status = typeof record.status === "string" ? record.status : undefined;
        const authStatus = typeof record.authStatus === "string" ? record.authStatus : undefined;
        const connected = typeof record.connected === "boolean" ? record.connected : undefined;
        const connectionState = normalizeMcpConnectionState(status, authStatus, connected);
        const authentication = normalizeMcpAuthentication(authStatus, connectionState);
        return {
          id: mcpServerId(provider, name),
          name,
          provider,
          scope: "chat" as const,
          source: "provider" as const,
          available: true,
          connectionState,
          ...(authentication ? { authentication } : {}),
          status,
          authStatus,
          connected,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    return items;
  }

  const record = asRecord(value);
  if (!record) return undefined;
  const items = Object.entries(record)
    .map(([name, details]) => {
      if (!name.trim()) return null;
      if (typeof details === "string") {
        const connectionState = normalizeMcpConnectionState(details);
        const authentication = normalizeMcpAuthentication(undefined, connectionState);
        return {
          id: mcpServerId(provider, name),
          name,
          provider,
          scope: "chat" as const,
          source: "provider" as const,
          available: true,
          connectionState,
          ...(authentication ? { authentication } : {}),
          status: details,
        };
      }
      if (typeof details === "boolean") {
        const status = details ? "connected" : "needs auth";
        return {
          id: mcpServerId(provider, name),
          name,
          provider,
          scope: "chat" as const,
          source: "provider" as const,
          available: true,
          connectionState: normalizeMcpConnectionState(status, undefined, details),
          status,
          connected: details,
        };
      }
      const detailRecord = asRecord(details);
      if (!detailRecord)
        return {
          id: mcpServerId(provider, name),
          name,
          provider,
          scope: "chat" as const,
          source: "provider" as const,
          available: true,
          connectionState: "unknown" as const,
        };
      const status =
        typeof detailRecord.status === "string"
          ? detailRecord.status
          : typeof detailRecord.state === "string"
            ? detailRecord.state
            : undefined;
      const authStatus =
        typeof detailRecord.authStatus === "string" ? detailRecord.authStatus : undefined;
      const connected =
        typeof detailRecord.connected === "boolean" ? detailRecord.connected : undefined;
      const connectionState = normalizeMcpConnectionState(status, authStatus, connected);
      const authentication = normalizeMcpAuthentication(authStatus, connectionState);
      return {
        id: mcpServerId(provider, name),
        name,
        provider,
        scope: "chat" as const,
        source: "provider" as const,
        available: true,
        connectionState,
        ...(authentication ? { authentication } : {}),
        status,
        authStatus,
        connected,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
  return items;
}

export function normalizeSessionInitPayload(
  raw: unknown,
  provider: ProviderKind = "claude",
): Record<string, unknown> | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;

  const payload: Record<string, unknown> = {};

  const sessionId =
    typeof record.session_id === "string"
      ? record.session_id
      : typeof record.sessionId === "string"
        ? record.sessionId
        : undefined;
  if (sessionId) payload.sessionId = sessionId;

  if (typeof record.model === "string") payload.model = record.model;
  if (typeof record.cwd === "string") payload.cwd = record.cwd;

  const tools = normalizeStringList(record.tools);
  if (tools) payload.tools = tools;

  const slashCommands =
    normalizeSlashCommandList(record.slash_commands) ??
    normalizeSlashCommandList(record.slashCommands) ??
    normalizeSlashCommandList(record.commands);
  if (slashCommands) payload.slashCommands = slashCommands;

  const skills = normalizeSkillList(record.skills);
  if (skills) payload.skills = skills;

  const commands =
    normalizeStringList(record.commands) ??
    slashCommands?.map((command) => command.name) ??
    skills?.flatMap((skill) => (typeof skill.name === "string" ? [skill.name] : []));
  if (commands) payload.commands = commands;

  const agents =
    normalizeAgents(record.agents) ??
    normalizeAgents(record.agent_types) ??
    normalizeAgents(record.agentTypes);
  if (agents) payload.agents = agents;

  const mcpServers = normalizeMcpServers(record.mcp_servers ?? record.mcpServers, provider);
  if (mcpServers !== undefined) payload.mcpServers = mcpServers;

  return Object.keys(payload).length > 0 ? payload : undefined;
}

export function buildSessionInitEvent(
  raw: unknown,
  overrides?: Record<string, unknown>,
  provider: ProviderKind = "claude",
): SystemEventMessage {
  return {
    type: "system_event",
    event: "session_init",
    payload: {
      ...(normalizeSessionInitPayload(raw, provider) ?? {}),
      ...(overrides ?? {}),
    },
    raw,
  };
}
