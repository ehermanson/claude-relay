import type { SystemEventMessage } from "#core/types.js";

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

function normalizeAgents(value: unknown): Array<string | JsonRecord> | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string | JsonRecord => {
    if (typeof item === "string") return item.trim().length > 0;
    const record = asRecord(item);
    return !!record && typeof record.name === "string" && record.name.trim().length > 0;
  });
  return items.length > 0 ? items : undefined;
}

function normalizeMcpServers(value: unknown): Array<{ name: string; status?: string }> | undefined {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => {
        if (typeof item === "string" && item.trim()) return { name: item };
        const record = asRecord(item);
        if (!record) return null;
        const name = typeof record.name === "string" ? record.name : undefined;
        if (!name?.trim()) return null;
        const status = typeof record.status === "string" ? record.status : undefined;
        return { name, status };
      })
      .filter((item): item is { name: string; status?: string } => !!item);
    return items.length > 0 ? items : undefined;
  }

  const record = asRecord(value);
  if (!record) return undefined;
  const items = Object.entries(record)
    .map(([name, details]) => {
      if (!name.trim()) return null;
      if (typeof details === "string") return { name, status: details };
      if (typeof details === "boolean")
        return { name, status: details ? "connected" : "needs auth" };
      const detailRecord = asRecord(details);
      if (!detailRecord) return { name };
      const status =
        typeof detailRecord.status === "string"
          ? detailRecord.status
          : typeof detailRecord.state === "string"
            ? detailRecord.state
            : undefined;
      return { name, status };
    })
    .filter((item): item is { name: string; status?: string } => !!item);
  return items.length > 0 ? items : undefined;
}

export function normalizeSessionInitPayload(raw: unknown): Record<string, unknown> | undefined {
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

  const commands =
    normalizeStringList(record.commands) ??
    normalizeStringList(record.slash_commands) ??
    normalizeStringList(record.slashCommands) ??
    normalizeStringList(record.skills);
  if (commands) payload.commands = commands;

  const agents =
    normalizeAgents(record.agents) ??
    normalizeAgents(record.agent_types) ??
    normalizeAgents(record.agentTypes);
  if (agents) payload.agents = agents;

  const mcpServers = normalizeMcpServers(record.mcp_servers ?? record.mcpServers);
  if (mcpServers) payload.mcpServers = mcpServers;

  return Object.keys(payload).length > 0 ? payload : undefined;
}

export function buildSessionInitEvent(
  raw: unknown,
  overrides?: Record<string, unknown>,
): SystemEventMessage {
  return {
    type: "system_event",
    event: "session_init",
    payload: {
      ...(normalizeSessionInitPayload(raw) ?? {}),
      ...(overrides ?? {}),
    },
    raw,
  };
}
