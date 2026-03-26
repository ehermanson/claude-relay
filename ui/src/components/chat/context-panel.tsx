import { memo, useMemo, useState } from "react";
import { Tooltip } from "../ui/tooltip";
import { Collapsible } from "../ui/collapsible";
import type { ChatItem } from "@/hooks/use-instance-messages";
import hljs from "../../lib/markdown";
import {
  escapeHtml,
  formatTokens,
  formatModel,
  formatTimestamp,
  getDisplaySessionStats,
  instanceStatusVariant,
} from "../../lib/utils";
import type { SessionStats, HistoryEntry, InstanceInfo } from "@shared/types";
import { ChevronIcon } from "./files-panel";
import { StatusDot } from "../ui/status-dot";

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
// Raw messages (instance mode only)
// =============================================================================

interface RawEntry {
  role: string;
  timestamp: number;
  json: unknown;
  label?: string;
  id?: string;
  preview?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getNestedValue(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

function truncateInline(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function findRawEntryId(json: unknown): string | undefined {
  return firstNonEmptyString(
    getNestedValue(json, ["message", "id"]),
    getNestedValue(json, ["message", "message", "id"]),
    getNestedValue(json, ["id"]),
    getNestedValue(json, ["toolUseId"]),
    getNestedValue(json, ["tool_use_id"]),
    getNestedValue(json, ["requestId"]),
    getNestedValue(json, ["request_id"]),
  );
}

function findPreviewText(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value == null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? truncateInline(trimmed) : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const preview = findPreviewText(item, depth + 1);
      if (preview) return preview;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  const priorityKeys = [
    "text",
    "description",
    "summary",
    "title",
    "message",
    "content",
    "parts",
    "input",
    "result",
    "arguments",
  ];
  for (const key of priorityKeys) {
    const preview = findPreviewText(value[key], depth + 1);
    if (preview) return preview;
  }
  for (const nested of Object.values(value)) {
    const preview = findPreviewText(nested, depth + 1);
    if (preview) return preview;
  }
  return undefined;
}

function stringifyJson(value: unknown): string {
  const formatted = JSON.stringify(value, null, 2);
  if (formatted !== undefined) return formatted;
  if (typeof value === "string") return value;
  return String(value);
}

function extractRawEntries(history: HistoryEntry[]): RawEntry[] {
  const entries: RawEntry[] = [];
  for (const entry of history) {
    const msg = entry.message;
    const json = entry.raw ?? msg;
    const id = findRawEntryId(json);
    const preview =
      msg.type === "user"
        ? firstNonEmptyString((msg as { text?: string }).text)
        : msg.type === "output"
          ? firstNonEmptyString((msg as { text?: string }).text)
          : msg.type === "activity"
            ? firstNonEmptyString((msg as { description?: string }).description)
            : undefined;
    const fallbackPreview = findPreviewText(json);
    if (msg.type === "user") {
      entries.push({
        role: "user",
        timestamp: entry.timestamp,
        json,
        id,
        preview: truncateInline(preview ?? fallbackPreview ?? "User message"),
      });
    } else if (msg.type === "output" && msg.isWaiting) {
      entries.push({
        role: "assistant",
        timestamp: entry.timestamp,
        json,
        id,
        preview: truncateInline(preview ?? fallbackPreview ?? "Assistant output"),
      });
    } else if (msg.type === "activity") {
      const act = msg as {
        activity?: string;
        tool?: string;
        description?: string;
      };
      const label = act.tool
        ? `${act.activity === "tool_result" ? "result" : "tool"}: ${act.tool}`
        : act.description;
      entries.push({
        role: "activity",
        timestamp: entry.timestamp,
        json,
        label,
        id,
        preview: truncateInline(fallbackPreview ?? label ?? "Activity"),
      });
    }
  }
  return entries;
}

function RawJsonBlock({ json }: { json: unknown }) {
  const formattedJson = useMemo(() => stringifyJson(json), [json]);
  const highlightedJson = useMemo(() => {
    try {
      return hljs.highlight(formattedJson, { language: "json" }).value;
    } catch {
      return escapeHtml(formattedJson);
    }
  }, [formattedJson]);
  const lines = useMemo(() => highlightedJson.split("\n"), [highlightedJson]);

  return (
    <div className="mx-3 mb-3 overflow-hidden rounded-md border border-border/50 bg-pre-bg/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="overflow-auto">
        <div className="hljs min-w-max bg-transparent">
          {lines.map((line, index) => (
            <div
              key={index}
              className="grid grid-cols-[2.25rem_minmax(0,1fr)] border-b border-border/30 last:border-b-0"
            >
              <span className="select-none border-r border-border/40 bg-panel-header/70 px-2 py-0.5 text-right font-mono text-[10px] leading-5 text-muted/55">
                {index + 1}
              </span>
              <span
                className="whitespace-pre px-3 py-0.5 font-mono text-[10px] leading-5 text-text/90"
                dangerouslySetInnerHTML={{ __html: line || " " }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RawEntryRow({ entry }: { entry: RawEntry }) {
  const [open, setOpen] = useState(false);
  const roleClass =
    entry.role === "user"
      ? "border-user-label/20 bg-user-label/10 text-user-label"
      : entry.role === "assistant"
        ? "border-claude/20 bg-claude-dim text-claude"
        : "border-border/70 bg-panel-header text-muted/90";
  const headline = entry.id ?? entry.label ?? `${entry.role} message`;

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      <div
        className={`overflow-hidden border-b transition-all border-border/60 bg-surface/70 hover:border-border/80 hover:bg-surface-hover/60`}
      >
        <Collapsible.Trigger className="flex w-full items-center gap-1 px-2 py-2 text-left">
          <div className="pt-0.5">
            <ChevronIcon open={open} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-1">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[0.5rem] font-semibold tracking-[0.08em] ${roleClass}`}
                  >
                    {entry.role}
                  </span>
                  <span className="truncate font-mono text-[0.6875rem] font-medium text-text-bright">
                    {headline}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1 text-[0.625rem] text-muted/65">
                <span className="tabular-nums">{formatTimestamp(entry.timestamp)}</span>
              </div>
            </div>
          </div>
        </Collapsible.Trigger>
        <Collapsible.Content className="border-t border-border/50 bg-panel-content/40 pt-2">
          <RawJsonBlock json={entry.json} />
        </Collapsible.Content>
      </div>
    </Collapsible.Root>
  );
}

// =============================================================================
// Context Panel — unified for instance and space views
// =============================================================================

interface InstanceContextProps {
  mode: "instance";
  stats: SessionStats;
  items: ChatItem[];
  rawHistory: HistoryEntry[] | null;
  provider?: string;
  preferredModel?: string;
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
  rawHistory,
  provider,
  preferredModel,
  createdAt,
  lastActivityAt,
}: InstanceContextProps) {
  const userCount = useMemo(() => items.filter((i) => i.kind === "user").length, [items]);
  const assistantCount = useMemo(() => items.filter((i) => i.kind === "assistant").length, [items]);
  const totalMessages = userCount + assistantCount;

  const rawEntries = useMemo(() => extractRawEntries(rawHistory ?? []), [rawHistory]);

  const displayStats = getDisplaySessionStats(provider, stats);
  const totalTokens = displayStats.totalTokens;
  const contextTokens = stats.contextTokens ?? 0;
  const contextWindow = stats.contextWindow ?? 0;
  const usagePct = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;
  const reasoning = stats.reasoningTokens ?? 0;
  const displayModel = stats.model ?? preferredModel;
  const segments = computeSegments(stats, provider);

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
          {contextWindow > 0 && (
            <>
              <StatRow
                label="Context Limit"
                help={
                  provider === "claude"
                    ? "Maximum context window for the current model. Claude limits are based on documented model limits."
                    : "Maximum context window reported by the current model."
                }
                value={formatTokens(contextWindow)}
              />
              <StatRow
                label="Usage"
                help="Estimated share of the context window currently occupied by the latest prompt state."
                value={`${usagePct.toFixed(1)}%`}
              />
            </>
          )}
          <StatRow
            label="Total Tokens"
            help="Chat total across input, output, and cache usage, normalized so cache-hit reads are not double-counted as input."
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
            value={formatTokens(stats.outputTokens)}
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
        {contextWindow > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-[0.6875rem] text-muted">
              <span>Context Window</span>
              <span className="tabular-nums">
                {formatTokens(contextTokens)} / {formatTokens(contextWindow)}
              </span>
            </div>
            <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-hover">
              <div
                className={`h-full rounded-full transition-all ${
                  usagePct > 90 ? "bg-red-400" : usagePct > 70 ? "bg-amber-400" : "bg-accent"
                }`}
                style={{ width: `${Math.min(usagePct, 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Raw messages */}
      {rawEntries.length > 0 && (
        <div className="border-t border-border/30">
          <div className="px-3.5 py-2.5 text-[0.6875rem] text-muted">Raw Messages</div>
          <div className="px-2 pb-2">
            <div className="flex flex-col gap-0 border border-border/60 rounded-md overflow-hidden">
              {rawEntries.map((entry, i) => (
                <RawEntryRow key={i} entry={entry} />
              ))}
            </div>
          </div>
        </div>
      )}
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
  const totalTokens = stats ? stats.inputTokens + stats.outputTokens : 0;
  const segments = stats ? computeSegments(stats) : [];

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
