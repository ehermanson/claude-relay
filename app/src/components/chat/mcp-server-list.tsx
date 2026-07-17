import type { ProviderKind, ProviderMcpServerStatus } from "@shared/types";
import { resolveMcpServersForChat } from "@shared/mcp";
import { Badge } from "../ui/badge";
import { Popover } from "../ui/popover";

const STATE_LABELS: Record<ProviderMcpServerStatus["connectionState"], string> = {
  connected: "Connected",
  connecting: "Connecting",
  needs_auth: "Needs authentication",
  failed: "Failed",
  disabled: "Disabled",
  unknown: "Status not reported",
};

function badgeVariant(server: ProviderMcpServerStatus): "success" | "warning" | "default" {
  if (server.connectionState === "connected") return "success";
  if (server.connectionState === "needs_auth" || server.connectionState === "failed")
    return "warning";
  return "default";
}

export function McpServerList({
  provider,
  globalServers,
  chatServers,
  context,
}: {
  provider: ProviderKind;
  globalServers?: ProviderMcpServerStatus[];
  chatServers?: ProviderMcpServerStatus[];
  context: "chat" | "provider";
}) {
  const servers = resolveMcpServersForChat(provider, globalServers, chatServers);
  if (!servers?.length) return null;

  return (
    <div className="mt-1">
      <div className="mb-1 text-[0.6875rem] text-muted">MCP servers</div>
      <Popover.Root>
        <Popover.Trigger
          className="flex flex-wrap gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          aria-label={`View ${servers.length} MCP server${servers.length === 1 ? "" : "s"}`}
        >
          {servers.map((server) => (
            <Badge key={server.id} variant={badgeVariant(server)} size="xs" dot>
              {server.name}
              {typeof server.toolCount === "number" ? ` (${server.toolCount})` : ""}
            </Badge>
          ))}
        </Popover.Trigger>
        <Popover.Content
          side="bottom"
          align="start"
          className="w-[min(24rem,calc(100vw-2rem))] !p-0"
        >
          <div className="border-b border-border/40 px-3 py-2">
            <div className="text-[0.8125rem] font-medium text-text-bright">MCP servers</div>
            <div className="mt-0.5 text-[0.6875rem] text-muted">
              {context === "chat"
                ? `Provider-reported state for this ${provider} Chat.`
                : `Provider-reported ${provider} state.`}
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {servers.map((server) => (
              <div key={server.id} className="rounded-lg px-2 py-1.5 hover:bg-surface-hover/60">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[0.8125rem] font-medium text-text-bright">
                      {server.name}
                    </div>
                    <div className="mt-0.5 text-[0.6875rem] text-muted">
                      {server.available === true && context === "chat"
                        ? "Available to this Chat"
                        : server.available === false && context === "chat"
                          ? "Not available to this Chat"
                          : server.scope === "global"
                            ? "Provider-level status"
                            : "Chat availability not reported"}
                    </div>
                  </div>
                  <Badge variant={badgeVariant(server)} size="xs">
                    {STATE_LABELS[server.connectionState]}
                  </Badge>
                </div>
                <div className="mt-1.5 text-[0.6875rem] text-muted">
                  Scope: {server.scope === "unknown" ? "Not reported" : server.scope}
                  {server.configured === true ? " · Configured" : ""}
                </div>
                {server.tools?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {server.tools.map((tool) => (
                      <span
                        key={tool.name}
                        title={tool.description}
                        className="rounded bg-surface-inset px-1.5 py-0.5 text-[0.6875rem] text-muted"
                      >
                        {tool.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-[0.6875rem] text-muted/70">
                    {typeof server.toolCount === "number"
                      ? `${server.toolCount} tools reported; names unavailable`
                      : "Tools not reported"}
                  </div>
                )}
                {server.detail ? (
                  <div className="mt-1.5 text-[0.6875rem] text-warning">{server.detail}</div>
                ) : null}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}
