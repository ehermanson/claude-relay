import { memo, useMemo } from "react";
import { Tooltip } from "../ui/tooltip";
import { Badge } from "../ui/badge";
import type { ChatItem } from "@/hooks/use-instance-messages";
import { useProviderRuntimeStore } from "@/stores/provider-runtime-store";
import {
  formatTokens,
  formatModel,
  formatTimestamp,
  getContextWindowUsage,
  getDisplaySessionStats,
  instanceStatusVariant,
} from "../../lib/utils";
import type {
  SessionStats,
  InstanceInfo,
  ProviderStatusSummary,
  ProviderGlobalState,
  ProviderKind,
} from "@shared/types";
import { StatusDot } from "../ui/status-dot";
import { ProviderLogo } from "../ui/provider-logo";
import { RateLimitBar, flattenRateLimitWindows } from "../ui/rate-limit-bar";

// =============================================================================
// Shared primitives
// =============================================================================

function StatHelpIcon({ tooltip }: { tooltip: string }) {
  return (
    <Tooltip content={tooltip} side="bottom">
      <span className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-border/70 text-[0.5625rem] font-semibold leading-none text-muted/75 transition-colors hover:border-border hover:text-text">
        ?
      </span>
    </Tooltip>
  );
}

function StatRow({ label, value, help }: { label: string; value: React.ReactNode; help?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-[0.6875rem] text-muted">
        <span>{label}</span>
        {help && <StatHelpIcon tooltip={help} />}
      </span>
      <span className="text-[0.8125rem] font-medium text-text-bright">{value}</span>
    </div>
  );
}

function statusTone(status: string | undefined): "default" | "active" | "success" | "warning" {
  const normalized = status?.toLowerCase() ?? "";
  if (/(inprogress|running|working|connected|authenticated)/.test(normalized)) return "active";
  if (/(completed|done|ready|idle|available)/.test(normalized)) return "success";
  if (/(warning|limited|pending|auth|disconnected|failed|error)/.test(normalized)) return "warning";
  return "default";
}

// =============================================================================
// Token breakdown bar (shared between both modes)
// =============================================================================

interface TokenBreakdownSegment {
  label: string;
  pct: number;
  color: string;
}

function computeSegments(stats: SessionStats, provider?: string): TokenBreakdownSegment[] {
  const display = getDisplaySessionStats(provider, stats);
  const cacheRead = display.cacheReadTokens;
  const cacheWrite = display.cacheCreationTokens;
  const pureInput = display.inputTokens;
  const output = stats.outputTokens;
  const total = pureInput + cacheRead + cacheWrite + output;
  if (total === 0) return [];
  return [
    { label: "Input", pct: (pureInput / total) * 100, color: "bg-blue-400" },
    { label: "Cache read", pct: (cacheRead / total) * 100, color: "bg-emerald-400" },
    { label: "Cache write", pct: (cacheWrite / total) * 100, color: "bg-amber-400" },
    { label: "Output", pct: (output / total) * 100, color: "bg-purple-400" },
  ].filter((s) => s.pct > 0);
}

function TokenBreakdownBar({ segments }: { segments: TokenBreakdownSegment[] }) {
  if (segments.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="mb-1.5 text-[0.6875rem] text-muted">Token Breakdown</div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-hover">
        {segments.map((seg) => (
          <Tooltip key={seg.label} content={`${seg.label} ${seg.pct.toFixed(1)}%`}>
            <div className={`h-full ${seg.color}`} style={{ width: `${seg.pct}%` }} />
          </Tooltip>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {segments.map((seg) => (
          <span key={seg.label} className="flex items-center gap-1 text-[0.625rem] text-muted">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${seg.color}`} />
            {seg.label} {seg.pct.toFixed(1)}%
          </span>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// Context Panel — unified for instance and space views
// =============================================================================

interface InstanceContextProps {
  mode: "instance";
  stats: SessionStats | null;
  items: ChatItem[];
  provider?: string;
  preferredModel?: string;
  providerStatus?: ProviderStatusSummary;
  providerGlobalState?: ProviderGlobalState;
  createdAt: number;
  lastActivityAt: number;
}

interface SpaceContextProps {
  mode: "space";
  stats: SessionStats | null;
  instances: InstanceInfo[];
  branch: string | null;
  status: string;
  activeCount: number;
  stoppedCount: number;
  createdAt: number;
}

export type ContextPanelProps = InstanceContextProps | SpaceContextProps;

export const ContextPanel = memo(function ContextPanel(props: ContextPanelProps) {
  if (props.mode === "instance") {
    return <InstanceContext {...props} />;
  }
  return <SpaceContext {...props} />;
});

// =============================================================================
// Instance context (chat sidecar)
// =============================================================================

function InstanceContext({
  stats,
  items,
  provider,
  preferredModel,
  providerStatus,
  providerGlobalState,
  createdAt,
  lastActivityAt,
}: InstanceContextProps) {
  const safeStats: SessionStats = stats ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
  const userCount = useMemo(() => items.filter((i) => i.kind === "user").length, [items]);
  const assistantCount = useMemo(() => items.filter((i) => i.kind === "assistant").length, [items]);
  const totalMessages = userCount + assistantCount;

  const displayStats = getDisplaySessionStats(provider, safeStats);
  const totalTokens = displayStats.totalTokens;
  const contextUsage = getContextWindowUsage(safeStats);
  const reasoning = safeStats.reasoningTokens ?? 0;
  const displayModel = safeStats.model ?? preferredModel;
  const segments = computeSegments(safeStats, provider);
  const globalProviderState = providerGlobalState;
  const hasProviderSummary = Boolean(
    providerStatus?.threadStatus ||
    providerStatus?.turnStatus ||
    providerStatus?.effectiveModel ||
    globalProviderState?.account?.label ||
    globalProviderState?.account?.email ||
    globalProviderState?.account?.plan ||
    globalProviderState?.account?.rateLimits?.length ||
    globalProviderState?.mcpServers?.length ||
    providerStatus?.notices?.length ||
    globalProviderState?.notices?.length,
  );

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Stats grid */}
      <div className="px-3.5 py-2.5">
        <div className="sidecar-stats-grid grid gap-x-4 gap-y-3">
          <StatRow
            label="Provider"
            value={provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : "—"}
          />
          <StatRow label="Model" value={displayModel ? formatModel(displayModel) : "—"} />
          {contextUsage.contextWindow > 0 && (
            <>
              <StatRow
                label="Context Limit"
                help={
                  provider === "claude"
                    ? "Maximum context window for the current model. Claude limits are based on documented model limits."
                    : "Maximum context window reported by the current model."
                }
                value={formatTokens(contextUsage.contextWindow)}
              />
              <StatRow
                label="Context Usage"
                help="Estimated share of the context window occupied by the latest prompt state, not the whole session."
                value={`${contextUsage.usagePct.toFixed(1)}%`}
              />
            </>
          )}
          <StatRow
            label="Session Tokens"
            help="Cumulative chat total across input, output, and cache usage, normalized so cache-hit reads are not double-counted as input."
            value={formatTokens(totalTokens)}
          />
          <StatRow label="Messages" value={totalMessages} />
          <StatRow
            label="Input Tokens"
            help="Non-cache request tokens sent during this chat. For providers that fold cache-hit reads into input, this view subtracts those reads back out."
            value={formatTokens(displayStats.inputTokens)}
          />
          <StatRow
            label="Output Tokens"
            help="Tokens generated in model responses during this chat."
            value={formatTokens(safeStats.outputTokens)}
          />
          {reasoning > 0 && (
            <StatRow
              label="Reasoning Tokens"
              help="Internal reasoning tokens reported separately by models that expose thinking usage."
              value={formatTokens(reasoning)}
            />
          )}
          <StatRow
            label="Cache Tokens (read/write)"
            help="Prompt-cache tokens reused from earlier work or written for future reuse. Read tokens may also be counted in input."
            value={`${formatTokens(displayStats.cacheReadTokens)} / ${formatTokens(displayStats.cacheCreationTokens)}`}
          />
          <StatRow label="User Messages" value={userCount} />
          <StatRow label="Assistant Messages" value={assistantCount} />
          <div className="sidecar-stats-divider border-t border-border/30" />
          <StatRow label="Chat Created" value={formatTimestamp(createdAt)} />
          <StatRow label="Last Activity" value={formatTimestamp(lastActivityAt)} />
        </div>

        <TokenBreakdownBar segments={segments} />

        {/* Context window usage bar */}
        {contextUsage.contextWindow > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-[0.6875rem] text-muted">
              <span>Current Context</span>
              <span className="tabular-nums">
                {formatTokens(contextUsage.contextTokens)} /{" "}
                {formatTokens(contextUsage.contextWindow)}
              </span>
            </div>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-hover">
              <div
                className={`h-full rounded-full transition-all ${
                  contextUsage.usagePct > 90
                    ? "bg-red-400"
                    : contextUsage.usagePct > 70
                      ? "bg-amber-400"
                      : "bg-accent"
                }`}
                style={{ width: `${Math.min(contextUsage.usagePct, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {hasProviderSummary && provider && (
        <div className="border-t border-border/30 px-3.5 py-2.5">
          <div className="mb-1.5 text-[0.6875rem] text-muted">Provider Status</div>
          <ProviderStatusBlock
            provider={provider}
            providerStatus={providerStatus}
            globalState={globalProviderState}
          />
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Shared: Provider status block (reused by instance + space context)
// =============================================================================

function ProviderStatusBlock({
  provider,
  providerStatus,
  globalState,
}: {
  provider: string;
  providerStatus?: ProviderStatusSummary;
  globalState?: ProviderGlobalState;
}) {
  const hasContent = Boolean(
    providerStatus?.threadStatus ||
    providerStatus?.turnStatus ||
    providerStatus?.effectiveModel ||
    globalState?.account?.label ||
    globalState?.account?.email ||
    globalState?.account?.plan ||
    globalState?.account?.rateLimits?.length ||
    globalState?.mcpServers?.length ||
    providerStatus?.notices?.length ||
    globalState?.notices?.length,
  );

  if (!hasContent && !provider) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Provider identity + status row */}
      <div className="flex items-center gap-2">
        <ProviderLogo provider={provider as ProviderKind} className="h-3.5 w-3.5 shrink-0" />
        <span className="text-[0.8125rem] font-medium text-text-bright">
          {provider === "codex"
            ? "Codex"
            : provider === "claude"
              ? "Claude Code"
              : provider.charAt(0).toUpperCase() + provider.slice(1)}
        </span>
        {globalState?.account?.plan ? (
          <>
            <span className="text-muted/40">·</span>
            <span className="text-[0.75rem] text-muted capitalize">{globalState.account.plan}</span>
          </>
        ) : null}
        {providerStatus?.turnStatus || providerStatus?.threadStatus ? (
          <>
            <span className="text-muted/40">·</span>
            <StatusDot
              variant={
                statusTone(providerStatus?.turnStatus ?? providerStatus?.threadStatus) === "active"
                  ? "active"
                  : statusTone(providerStatus?.turnStatus ?? providerStatus?.threadStatus) ===
                      "success"
                    ? "success"
                    : statusTone(providerStatus?.turnStatus ?? providerStatus?.threadStatus) ===
                        "warning"
                      ? "error"
                      : "default"
              }
              size={6}
            />
            <span className="text-[0.75rem] text-muted">
              {providerStatus?.turnStatus ?? providerStatus?.threadStatus}
            </span>
          </>
        ) : null}
      </div>

      {/* Effective model */}
      {providerStatus?.effectiveModel ? (
        <span className="text-[0.75rem] text-muted ml-5.5">
          {formatModel(providerStatus?.effectiveModel)}
          {providerStatus?.reroutedFromModel &&
          providerStatus.reroutedFromModel !== providerStatus.effectiveModel
            ? ` (from ${formatModel(providerStatus?.reroutedFromModel)})`
            : ""}
        </span>
      ) : null}

      {/* Rate limit bars */}
      {globalState?.account?.rateLimits?.length ? (
        <div className="flex flex-col gap-2 mt-0.5">
          {flattenRateLimitWindows(globalState.account.rateLimits).map(({ window, key }) => (
            <RateLimitBar key={key} window={window} size="sm" />
          ))}
        </div>
      ) : null}

      {/* MCP servers */}
      {globalState?.mcpServers?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {globalState.mcpServers.map((server) => (
            <Badge
              key={server.name}
              variant={
                statusTone(server.authStatus ?? server.status) === "warning"
                  ? "warning"
                  : statusTone(server.authStatus ?? server.status) === "success"
                    ? "success"
                    : "default"
              }
              size="xs"
              dot
              dotClass={
                statusTone(server.authStatus ?? server.status) === "active"
                  ? "bg-warning animate-pulse-dot"
                  : statusTone(server.authStatus ?? server.status) === "success"
                    ? "bg-accent"
                    : "bg-muted"
              }
            >
              {server.name}
              {typeof server.toolCount === "number" ? ` (${server.toolCount})` : ""}
            </Badge>
          ))}
        </div>
      ) : null}

      {/* Notices */}
      {providerStatus?.notices?.length || globalState?.notices?.length ? (
        <div className="flex flex-col gap-1">
          {[...(globalState?.notices ?? []), ...(providerStatus?.notices ?? [])].map(
            (notice, index) => (
              <div
                key={`${notice.source ?? "notice"}-${index}`}
                className="text-[0.75rem] text-warning"
              >
                {notice.message}
                {notice.detail ? <span className="ml-1 text-muted">{notice.detail}</span> : null}
              </div>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

// =============================================================================
// Space context (space sidebar)
// =============================================================================

function SpaceContext({
  stats,
  instances,
  branch,
  status,
  activeCount,
  stoppedCount,
  createdAt,
}: SpaceContextProps) {
  const totalTokens = stats
    ? stats.inputTokens + stats.outputTokens + stats.cacheCreationTokens + stats.cacheReadTokens
    : 0;
  const segments = stats ? computeSegments(stats) : [];

  // Collect unique providers used in this space
  const providerGlobalStates = useProviderRuntimeStore((s) => s.providerGlobalState);
  const uniqueProviders = useMemo(() => {
    const seen = new Set<string>();
    for (const inst of instances) {
      if (inst.provider) seen.add(inst.provider);
    }
    return Array.from(seen);
  }, [instances]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-3.5 py-2.5">
        <div className="sidecar-stats-grid grid gap-x-4 gap-y-3">
          <StatRow label="Branch" value={branch ?? "—"} />
          <StatRow label="Status" value={status} />
          <StatRow label="Chats" value={instances.length} />
          {activeCount > 0 && <StatRow label="Active" value={activeCount} />}
          {stoppedCount > 0 && <StatRow label="Ended" value={stoppedCount} />}
          {stats && (
            <>
              <div className="sidecar-stats-divider border-t border-border/30" />
              <StatRow label="Total Tokens" value={formatTokens(totalTokens)} />
              <StatRow label="Input Tokens" value={formatTokens(stats.inputTokens)} />
              <StatRow label="Output Tokens" value={formatTokens(stats.outputTokens)} />
              <StatRow
                label="Cache Tokens (read/write)"
                value={`${formatTokens(stats.cacheReadTokens)} / ${formatTokens(stats.cacheCreationTokens)}`}
              />
            </>
          )}
          <div className="sidecar-stats-divider border-t border-border/30" />
          <StatRow label="Created" value={formatTimestamp(createdAt)} />
        </div>

        <TokenBreakdownBar segments={segments} />
      </div>

      {/* Provider status — one block per provider used in the space */}
      {uniqueProviders.length > 0 && (
        <div className="border-t border-border/30 px-3.5 py-2.5">
          <div className="mb-1.5 text-[0.6875rem] text-muted">Provider Status</div>
          <div className="flex flex-col gap-3">
            {uniqueProviders.map((p) => (
              <ProviderStatusBlock
                key={p}
                provider={p}
                globalState={providerGlobalStates[p as ProviderKind]}
              />
            ))}
          </div>
        </div>
      )}

      {/* Per-chat breakdown */}
      {instances.length > 0 && (
        <div className="border-t border-border/30">
          <div className="px-3.5 py-2.5 text-[0.6875rem] text-muted">Per-chat</div>
          <div className="flex flex-col gap-0.5 px-3.5 pb-3">
            {instances.map((inst) => (
              <div key={inst.id} className="flex items-center gap-2 py-1">
                <StatusDot variant={instanceStatusVariant(inst.status)} />
                <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-text">
                  {inst.name}
                </span>
                {inst.stats && (
                  <span className="shrink-0 text-[0.6875rem] text-muted/50">
                    {formatTokens(getDisplaySessionStats(inst.provider, inst.stats).totalTokens)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
