import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, FileDiff, X } from "lucide-react";
import { MarkdownContent } from "@/components/chat/markdown-content";
import { Button } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import { FileIcon } from "@/components/ui/file-icon";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import type { ChatItem } from "@/hooks/use-instance-messages";
import hljs from "@/lib/markdown";
import { escapeHtml, formatModel, formatTimestamp, formatTokens } from "@/lib/utils";
import type { TaskItem, FileChange, SessionStats, HistoryEntry } from "@shared/types";

const DiffDrawer = lazy(() => import("./diff-drawer").then((m) => ({ default: m.DiffDrawer })));

const PlanPanel = memo(function PlanPanel({ content }: { content: string }) {
  return (
    <div className="flex-1 overflow-y-auto px-3.5 py-3 text-[0.8125rem]">
      <MarkdownContent text={content} />
    </div>
  );
});

function StatusIcon({ status }: { status: TaskItem["status"] }) {
  switch (status) {
    case "completed":
      return (
        <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded bg-accent-dim text-accent">
          <Check size={10} strokeWidth={3} />
        </div>
      );
    case "in_progress":
      return (
        <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
          <Spinner size={14} />
        </div>
      );
    case "pending":
      return (
        <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
          <div className="h-[14px] w-[14px] rounded-full border-2 border-muted/30" />
        </div>
      );
  }
}

/** Strip the working directory prefix to show project-relative paths. */
function relativePath(filePath: string, cwd: string): string {
  if (cwd && filePath.startsWith(cwd)) {
    const rel = filePath.slice(cwd.length);
    // Strip leading slash
    return rel.startsWith("/") ? rel.slice(1) : rel;
  }
  return filePath;
}

function sameTasks(prev: TaskItem[] | null, next: TaskItem[] | null): boolean {
  const prevList = prev ?? [];
  const nextList = next ?? [];
  if (prevList.length !== nextList.length) return false;
  for (let i = 0; i < prevList.length; i++) {
    const a = prevList[i];
    const b = nextList[i];
    if (!b) return false;
    if (
      a.id !== b.id ||
      a.subject !== b.subject ||
      a.status !== b.status ||
      a.activeForm !== b.activeForm
    ) {
      return false;
    }
  }
  return true;
}

function sameFiles(prev: FileChange[] | null, next: FileChange[] | null): boolean {
  const prevList = prev ?? [];
  const nextList = next ?? [];
  if (prevList.length !== nextList.length) return false;
  for (let i = 0; i < prevList.length; i++) {
    const a = prevList[i];
    const b = nextList[i];
    if (!b) return false;
    if (
      a.path !== b.path ||
      a.editCount !== b.editCount ||
      a.type !== b.type ||
      a.additions !== b.additions ||
      a.deletions !== b.deletions
    ) {
      return false;
    }
  }
  return true;
}

const TasksPanel = memo(function TasksPanel({ tasks }: { tasks: TaskItem[] }) {
  const completed = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;
  const allDone = completed === total;

  return (
    <>
      {/* Progress bar */}
      <div className="shrink-0 px-3.5 py-2.5">
        <div className="flex items-center justify-between pb-1.5">
          <span className={`text-[0.75rem] font-medium ${allDone ? "text-accent" : "text-muted"}`}>
            {completed}/{total} done
          </span>
          {allDone && <span className="text-[0.625rem] font-medium text-accent">Complete</span>}
        </div>
        <Progress value={progress} indicatorClass={allDone ? "bg-accent" : "bg-claude"} />
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="flex flex-col gap-0.5">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem] leading-snug transition-colors hover:bg-surface-hover"
            >
              <div className="mt-px">
                <StatusIcon status={task.status} />
              </div>
              <span
                className={`min-w-0 ${
                  task.status === "completed" ? "text-muted line-through" : "text-text"
                }`}
              >
                {task.status === "in_progress" && task.activeForm ? task.activeForm : task.subject}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
});

/** Chevron icon that rotates when open. */
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <ChevronRight
      size={12}
      strokeWidth={2.5}
      className={`shrink-0 text-muted transition-transform duration-150 ${open ? "rotate-90" : ""}`}
    />
  );
}

/** Format diff stats as colored +N / -N text. */
function DiffStats({ additions, deletions }: { additions?: number; deletions?: number }) {
  if (additions == null && deletions == null) return null;
  const add = additions ?? 0;
  const del = deletions ?? 0;
  return (
    <span className="shrink-0 text-[0.6875rem] font-medium tabular-nums">
      <span className="text-green-400">+{add}</span>
      <span className="text-muted/40"> / </span>
      <span className="text-red-400">-{del}</span>
    </span>
  );
}

interface DirGroup {
  dir: string;
  files: { basename: string; file: FileChange }[];
  totalEdits: number;
  additions: number;
  deletions: number;
  hasDiffStats: boolean;
}

function groupFilesByDir(files: FileChange[], cwd: string): DirGroup[] {
  const compare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  const map = new Map<string, { basename: string; file: FileChange }[]>();
  for (const file of files) {
    const rel = relativePath(file.path, cwd);
    const parts = rel.split("/");
    const basename = parts.pop() || rel;
    const dir = parts.join("/") || ".";
    let group = map.get(dir);
    if (!group) {
      group = [];
      map.set(dir, group);
    }
    group.push({ basename, file });
  }

  return Array.from(map.entries())
    .map(([dir, dirFiles]) => {
      const sortedFiles = [...dirFiles].sort(
        (a, b) =>
          compare(a.basename, b.basename) ||
          compare(relativePath(a.file.path, cwd), relativePath(b.file.path, cwd)),
      );
      let additions = 0;
      let deletions = 0;
      let hasDiffStats = false;
      for (const { file } of sortedFiles) {
        if (file.additions != null || file.deletions != null) {
          hasDiffStats = true;
          additions += file.additions ?? 0;
          deletions += file.deletions ?? 0;
        }
      }
      return {
        dir,
        files: sortedFiles,
        totalEdits: sortedFiles.reduce((sum, f) => sum + f.file.editCount, 0),
        additions,
        deletions,
        hasDiffStats,
      };
    })
    .sort((a, b) => {
      if (a.dir === "." && b.dir !== ".") return 1;
      if (b.dir === "." && a.dir !== ".") return -1;
      return compare(a.dir, b.dir);
    });
}

const FilesPanel = memo(function FilesPanel({
  files,
  cwd,
  onViewChanges,
  onFileClick,
}: {
  files: FileChange[];
  cwd: string;
  onViewChanges?: () => void;
  onFileClick?: (filePath: string) => void;
}) {
  const groups = useMemo(() => groupFilesByDir(files, cwd), [files, cwd]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleDir = (dir: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  const totalAdditions = groups.reduce((s, g) => s + g.additions, 0);
  const totalDeletions = groups.reduce((s, g) => s + g.deletions, 0);
  const hasDiffStats = groups.some((g) => g.hasDiffStats);

  return (
    <>
      {/* Header */}
      <div className="shrink-0 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[0.75rem] font-medium text-muted">
            {files.length} file{files.length !== 1 ? "s" : ""} changed
          </span>
          {hasDiffStats && (
            <span className="text-[0.6875rem] font-medium tabular-nums">
              <span className="text-green-400">+{totalAdditions}</span>
              <span className="text-muted/40"> / </span>
              <span className="text-red-400">-{totalDeletions}</span>
            </span>
          )}
          {onViewChanges && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onViewChanges}
              className="ml-auto !text-accent hover:!bg-accent/10"
            >
              <FileDiff size={12} className="shrink-0" />
              Full Diff
            </Button>
          )}
        </div>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="flex flex-col">
          {groups.map((group) => {
            const isOpen = !collapsed.has(group.dir);
            const showDir = group.dir !== ".";

            return (
              <Collapsible.Root
                key={group.dir}
                open={isOpen}
                onOpenChange={() => toggleDir(group.dir)}
              >
                {showDir && (
                  <Collapsible.Trigger className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.8125rem] leading-snug transition-colors hover:bg-surface-hover">
                    <ChevronIcon open={isOpen} />
                    <FileIcon path={group.dir} kind="directory" size={15} />
                    <span className="min-w-0 flex-1 truncate font-medium text-text-bright text-left">
                      {group.dir}
                    </span>
                    {group.hasDiffStats ? (
                      <DiffStats additions={group.additions} deletions={group.deletions} />
                    ) : (
                      <span className="shrink-0 text-[0.6875rem] font-medium text-muted/60">
                        {group.totalEdits > group.files.length
                          ? `${group.files.length} · ×${group.totalEdits}`
                          : `${group.files.length}`}
                      </span>
                    )}
                  </Collapsible.Trigger>
                )}
                <Collapsible.Content>
                  <div className={showDir ? "ml-5" : ""}>
                    {group.files.map(({ basename, file }) => (
                      <Tooltip key={file.path} content={relativePath(file.path, cwd)} side="left">
                        <div
                          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.8125rem] leading-snug transition-colors hover:bg-surface-hover${onFileClick ? " cursor-pointer" : ""}`}
                          onClick={
                            onFileClick
                              ? () => onFileClick(relativePath(file.path, cwd))
                              : undefined
                          }
                        >
                          <FileIcon path={file.path} size={15} />
                          <span className="min-w-0 flex-1 truncate text-text">{basename}</span>
                          {file.additions != null || file.deletions != null ? (
                            <DiffStats additions={file.additions} deletions={file.deletions} />
                          ) : file.editCount > 1 ? (
                            <span className="shrink-0 text-[0.6875rem] font-medium text-muted/60">
                              ×{file.editCount}
                            </span>
                          ) : null}
                        </div>
                      </Tooltip>
                    ))}
                  </div>
                </Collapsible.Content>
              </Collapsible.Root>
            );
          })}
        </div>
      </div>
    </>
  );
});

// =============================================================================
// Context Panel
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

/** Collapsed history entries: keep only user/output(isWaiting)/activity(tool_use/tool_result) */
interface RawEntry {
  role: string;
  timestamp: number;
  json: unknown;
  /** Short label for the collapsed row (e.g. tool name) */
  label?: string;
  /** Stable identifier surfaced from the raw payload when present. */
  id?: string;
  /** Human-readable preview shown under the header. */
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
    // Prefer entry.raw (rich SDK data) over the simplified ServerMessage
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

const ContextPanel = memo(function ContextPanel({
  stats,
  items,
  rawHistory,
  provider,
  preferredModel,
  createdAt,
  lastActivityAt,
}: {
  stats: SessionStats;
  items: ChatItem[];
  rawHistory: HistoryEntry[] | null;
  provider?: string;
  preferredModel?: string;
  createdAt: number;
  lastActivityAt: number;
}) {
  const userCount = useMemo(() => items.filter((i) => i.kind === "user").length, [items]);
  const assistantCount = useMemo(() => items.filter((i) => i.kind === "assistant").length, [items]);
  const totalMessages = userCount + assistantCount;

  const rawEntries = useMemo(() => extractRawEntries(rawHistory ?? []), [rawHistory]);

  const totalTokens = stats.inputTokens + stats.outputTokens;
  const contextTokens = stats.contextTokens ?? 0;
  const contextWindow = stats.contextWindow ?? 0;
  const usagePct = contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0;

  const cacheRead = stats.cacheReadTokens;
  const cacheWrite = stats.cacheCreationTokens;
  const pureInput = stats.inputTokens;
  const output = stats.outputTokens;
  const reasoning = stats.reasoningTokens ?? 0;
  const breakdownTotal = pureInput + cacheRead + cacheWrite + output;
  const displayModel = stats.model ?? preferredModel;

  const segments =
    breakdownTotal > 0
      ? [
          {
            label: "Input",
            pct: (pureInput / breakdownTotal) * 100,
            color: "bg-blue-400",
          },
          {
            label: "Cache read",
            pct: (cacheRead / breakdownTotal) * 100,
            color: "bg-emerald-400",
          },
          {
            label: "Cache write",
            pct: (cacheWrite / breakdownTotal) * 100,
            color: "bg-amber-400",
          },
          {
            label: "Output",
            pct: (output / breakdownTotal) * 100,
            color: "bg-purple-400",
          },
        ].filter((s) => s.pct > 0)
      : [];

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Stats grid */}
      <div className="px-3.5 py-2.5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
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
            help="Chat total based on the provider's reported input plus output usage. Cache reads may already be folded into input."
            value={formatTokens(totalTokens)}
          />
          <StatRow label="Messages" value={totalMessages} />
          <StatRow
            label="Input Tokens"
            help="Tokens sent in requests during this chat. Some providers include cache-hit tokens here."
            value={formatTokens(stats.inputTokens)}
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
            value={`${formatTokens(cacheRead)} / ${formatTokens(cacheWrite)}`}
          />
          <StatRow label="User Messages" value={userCount} />
          <StatRow label="Assistant Messages" value={assistantCount} />
          <div className="col-span-2 border-t border-border/30" />
          <StatRow label="Chat Created" value={formatTimestamp(createdAt)} />
          <StatRow label="Last Activity" value={formatTimestamp(lastActivityAt)} />
        </div>

        {/* Context breakdown bar */}
        {segments.length > 0 && (
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
                <span
                  key={seg.label}
                  className="flex items-center gap-1 text-[0.625rem] text-muted"
                >
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${seg.color}`} />
                  {seg.label} {seg.pct.toFixed(1)}%
                </span>
              ))}
            </div>
          </div>
        )}

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
});

// =============================================================================
// Tab system
// =============================================================================

export type SidecarTab = "tasks" | "files" | "plan" | "context";

function samePanelSets(a: ReadonlySet<SidecarTab>, b: ReadonlySet<SidecarTab>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}

interface SidecarProps {
  tasks: TaskItem[] | null;
  files: FileChange[] | null;
  planContent?: string | null;
  stats?: SessionStats | null;
  items?: ChatItem[];
  rawHistory?: HistoryEntry[] | null;
  provider?: string;
  preferredModel?: string;
  /** @deprecated Currently unused but kept for the custom comparator. */
  instanceName?: string;
  instanceId?: string;
  createdAt?: number;
  lastActivityAt?: number;
  workingDirectory: string;
  /** Which panels are toggled on from the header. */
  activePanels: ReadonlySet<SidecarTab>;
  /** Called when mobile overlay should close. */
  onClose?: () => void;
  isMobileOverlay?: boolean;
}

export const Sidecar = memo(
  function Sidecar({
    tasks,
    files,
    planContent,
    stats,
    items,
    rawHistory,
    provider,
    preferredModel,
    instanceName,
    instanceId,
    createdAt,
    lastActivityAt,
    workingDirectory,
    activePanels,
    onClose,
    isMobileOverlay,
  }: SidecarProps) {
    const hasTasks = tasks && tasks.length > 0;
    const hasFiles = files && files.length > 0;
    const hasPlan = !!planContent;
    const hasStats = !!stats && (stats.inputTokens > 0 || stats.outputTokens > 0);

    const [diffDrawerOpen, setDiffDrawerOpen] = useState(false);
    const [diffScrollToFile, setDiffScrollToFile] = useState<string | undefined>();

    const openDiffDrawer = (scrollTo?: string) => {
      setDiffScrollToFile(scrollTo);
      setDiffDrawerOpen(true);
    };

    // Build available tabs: must have content AND be in activePanels
    const availableTabs = useMemo(() => {
      const tabs: { key: SidecarTab; label: string; count: number }[] = [];
      if (hasTasks && activePanels.has("tasks"))
        tabs.push({ key: "tasks", label: "Tasks", count: tasks.length });
      if (hasFiles && activePanels.has("files"))
        tabs.push({ key: "files", label: "Files", count: files.length });
      if (hasPlan && activePanels.has("plan")) tabs.push({ key: "plan", label: "Plan", count: 0 });
      if (hasStats && activePanels.has("context"))
        tabs.push({ key: "context", label: "Context", count: 0 });
      return tabs;
    }, [activePanels, files, hasFiles, hasTasks, hasStats, tasks]);

    const [activeTab, setActiveTab] = useState<SidecarTab>("tasks");

    // Auto-switch to newly added panel when toggled on from the header
    const prevActivePanelsRef = useRef(activePanels);
    useEffect(() => {
      const prev = prevActivePanelsRef.current;
      prevActivePanelsRef.current = activePanels;
      for (const panel of activePanels) {
        if (!prev.has(panel)) {
          setActiveTab(panel);
          return;
        }
      }
    }, [activePanels]);

    // Resolve effective tab: if activeTab isn't available, fall back to first available
    const effectiveTab =
      availableTabs.find((t) => t.key === activeTab)?.key ?? availableTabs[0]?.key ?? "tasks";

    const panel = (
      <div
        className={
          isMobileOverlay
            ? "animate-slide-in-right flex h-full w-[85vw] max-w-sm flex-col overflow-hidden rounded-l-2xl border-l border-border bg-surface shadow-2xl"
            : "flex h-full w-full flex-col overflow-hidden border-l border-border/50 bg-surface"
        }
      >
        {/* Header */}
        <div className="shrink-0 border-b border-border/60">
          <div className="flex items-center justify-between">
            {availableTabs.length > 1 ? (
              <div className="flex min-w-0 flex-1 items-stretch">
                {availableTabs.map((tab) => {
                  const isActive = tab.key === effectiveTab;
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={`relative flex min-w-0 flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-[0.8125rem] font-semibold transition-colors ${
                        isActive
                          ? "border-accent text-text-bright"
                          : "border-transparent text-muted hover:text-text"
                      }`}
                    >
                      <span className="truncate">{tab.label}</span>
                      {tab.count > 0 && (
                        <span
                          className={`shrink-0 text-[0.75rem] tabular-nums ${
                            isActive ? "text-text" : "text-muted/70"
                          }`}
                        >
                          {tab.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <h2 className="px-3.5 py-2.5 text-[0.8125rem] font-semibold text-text-bright">
                {availableTabs[0]?.label ?? "Sidecar"}
              </h2>
            )}
            {isMobileOverlay && onClose && (
              <Button variant="icon" size="icon-sm" onClick={onClose} className="mr-2 shrink-0">
                <X size={14} />
              </Button>
            )}
          </div>
        </div>

        {/* Panel content */}
        {effectiveTab === "tasks" && hasTasks && <TasksPanel tasks={tasks} />}
        {effectiveTab === "plan" && hasPlan && <PlanPanel content={planContent} />}
        {effectiveTab === "files" && hasFiles && (
          <FilesPanel
            files={files}
            cwd={workingDirectory}
            onViewChanges={instanceId ? () => openDiffDrawer() : undefined}
            onFileClick={instanceId ? (path) => openDiffDrawer(path) : undefined}
          />
        )}
        {effectiveTab === "context" && hasStats && (
          <ContextPanel
            stats={stats!}
            items={items ?? []}
            rawHistory={rawHistory ?? null}
            provider={provider}
            preferredModel={preferredModel}
            createdAt={createdAt ?? Date.now()}
            lastActivityAt={lastActivityAt ?? Date.now()}
          />
        )}
      </div>
    );

    const diffDrawer = diffDrawerOpen && instanceId && (
      <Suspense>
        <DiffDrawer
          instanceId={instanceId}
          knownFiles={files ?? undefined}
          workingDirectory={workingDirectory}
          onClose={() => setDiffDrawerOpen(false)}
          scrollToFile={diffScrollToFile}
        />
      </Suspense>
    );

    if (isMobileOverlay) {
      return (
        <>
          <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
            <div className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div className="relative h-full" onClick={(e) => e.stopPropagation()}>
              {panel}
            </div>
          </div>
          {diffDrawer}
        </>
      );
    }

    return (
      <>
        {panel}
        {diffDrawer}
      </>
    );
  },
  (prev, next) => {
    return (
      samePanelSets(prev.activePanels, next.activePanels) &&
      prev.workingDirectory === next.workingDirectory &&
      prev.isMobileOverlay === next.isMobileOverlay &&
      prev.instanceId === next.instanceId &&
      prev.instanceName === next.instanceName &&
      prev.createdAt === next.createdAt &&
      prev.lastActivityAt === next.lastActivityAt &&
      prev.stats === next.stats &&
      prev.items === next.items &&
      prev.rawHistory === next.rawHistory &&
      prev.preferredModel === next.preferredModel &&
      prev.planContent === next.planContent &&
      sameTasks(prev.tasks, next.tasks) &&
      sameFiles(prev.files, next.files)
    );
  },
);
