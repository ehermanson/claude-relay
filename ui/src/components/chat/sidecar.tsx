import { memo, useMemo, useState } from "react";
import { Tabs } from "../ui/tabs";
import { Progress } from "../ui/progress";
import { Spinner } from "../ui/spinner";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import { Collapsible } from "../ui/collapsible";
import { FileIcon } from "../ui/file-icon";
import hljs from "../../lib/markdown";
import { escapeHtml, formatTokens, formatModel, formatTimestamp } from "../../lib/utils";
import type {
  TaskItem,
  FileChange,
  TeamInfo,
  TeamMember,
  AgentActivity,
  SessionStats,
  HistoryEntry,
} from "@shared/types";
import type { ChatItem } from "../../hooks/use-instance-messages";

function StatusIcon({ status }: { status: TaskItem["status"] }) {
  switch (status) {
    case "completed":
      return (
        <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded bg-accent-dim text-accent">
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
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

function MemberStatusIcon({ status }: { status: TeamMember["status"] }) {
  switch (status) {
    case "running":
      return (
        <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
          <Spinner size={14} />
        </div>
      );
    case "shutting_down":
      return (
        <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-warning">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        </div>
      );
    case "shutdown":
      return (
        <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded bg-accent-dim text-accent">
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
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

function looksLikeOpaqueAgentId(value: string): boolean {
  return /^[a-f0-9]{12,}$/i.test(value);
}

function getAgentLabel(value: string, index: number, fallback?: string): string {
  if (!looksLikeOpaqueAgentId(value)) return value;
  return fallback || `Agent ${index + 1}`;
}

function isCompletedAgentActivity(activity: AgentActivity): boolean {
  const text = activity.description?.trim().toLowerCase() || "";
  return text.startsWith("completed:") || text.startsWith("complete:");
}

function AgentRowIcon({ completed }: { completed: boolean }) {
  if (completed) {
    return (
      <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded bg-accent-dim text-accent">
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    );
  }

  return (
    <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
      <Spinner size={14} />
    </div>
  );
}

function sameAgentActivities(
  prev: AgentActivity[] | null | undefined,
  next: AgentActivity[] | null | undefined,
): boolean {
  const prevList = prev ?? [];
  const nextList = next ?? [];
  if (prevList.length !== nextList.length) return false;
  for (let i = 0; i < prevList.length; i++) {
    const a = prevList[i];
    const b = nextList[i];
    if (!b) return false;
    if (a.agentId !== b.agentId || a.description !== b.description || a.tool !== b.tool) {
      return false;
    }
  }
  return true;
}

function sameTeam(prev: TeamInfo | null, next: TeamInfo | null): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  if (prev.name !== next.name || prev.description !== next.description) return false;
  if (prev.members.length !== next.members.length) return false;
  for (let i = 0; i < prev.members.length; i++) {
    const a = prev.members[i];
    const b = next.members[i];
    if (!b) return false;
    if (
      a.name !== b.name ||
      a.subagentType !== b.subagentType ||
      a.description !== b.description ||
      a.status !== b.status
    ) {
      return false;
    }
  }
  return true;
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

const TeamPanel = memo(
  function TeamPanel({
    team,
    agentActivities,
  }: {
    team: TeamInfo | null;
    agentActivities?: AgentActivity[] | null;
  }) {
    const members = team?.members ?? [];
    const running = useMemo(
      () => members.filter((member) => member.status === "running").length,
      [members],
    );
    const total = members.length;

    const { activityByName, unmatchedActivities } = useMemo(() => {
      const nextActivityByName = new Map<string, AgentActivity>();
      const nextUnmatchedActivities: AgentActivity[] = [];
      if (agentActivities) {
        const memberNames = new Set(members.map((member) => member.name));
        for (const activity of agentActivities) {
          if (memberNames.has(activity.agentId)) {
            nextActivityByName.set(activity.agentId, activity);
          } else {
            nextUnmatchedActivities.push(activity);
          }
        }
      }
      return {
        activityByName: nextActivityByName,
        unmatchedActivities: nextUnmatchedActivities,
      };
    }, [agentActivities, members]);

    const unmatchedActiveCount = useMemo(
      () => unmatchedActivities.filter((activity) => !isCompletedAgentActivity(activity)).length,
      [unmatchedActivities],
    );

    return (
      <>
        {/* Team header */}
        <div className="shrink-0 px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <div className="text-[0.8125rem] font-semibold text-text-bright">
              {team?.name ?? "Agents"}
            </div>
            <span className="rounded-full bg-accent-dim px-1.5 py-px text-[0.625rem] font-semibold tabular-nums text-accent">
              {total > 0 ? `${running}/${total}` : unmatchedActiveCount}
            </span>
          </div>
          {team?.description && (
            <div className="mt-0.5 text-[0.75rem] text-muted">{team.description}</div>
          )}
        </div>

        {/* Member list */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          <div className="flex flex-col gap-0.5">
            {members.map((member, index) => {
              const activity = activityByName.get(member.name);
              const memberLabel = getAgentLabel(member.name, index, member.subagentType);
              return (
                <div
                  key={member.name}
                  className="flex items-start gap-2.5 rounded-lg bg-surface px-2.5 py-2 text-[0.8125rem] leading-snug"
                >
                  <div className="mt-px">
                    <MemberStatusIcon status={member.status} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate font-medium ${
                        member.status === "shutdown" ? "text-muted line-through" : "text-text"
                      }`}
                    >
                      {memberLabel}
                    </div>
                    <div className="truncate text-[0.75rem] text-muted">
                      {activity?.description || activity?.tool || member.subagentType}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Unmatched agent activities (agentId doesn't match any member name) */}
            {unmatchedActivities.map((a, index) => {
              const completed = isCompletedAgentActivity(a);
              return (
                <div
                  key={a.agentId}
                  className="flex items-start gap-2.5 rounded-lg bg-surface px-2.5 py-2 text-[0.8125rem] leading-snug"
                >
                  <div className="mt-px">
                    <AgentRowIcon completed={completed} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div
                      className={`truncate font-medium ${completed ? "text-muted" : "text-text"}`}
                    >
                      {getAgentLabel(a.agentId, index)}
                    </div>
                    <div className="truncate text-[0.75rem] text-muted">
                      {a.description || a.tool || "Working..."}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </>
    );
  },
  (prev, next) =>
    sameTeam(prev.team, next.team) &&
    sameAgentActivities(prev.agentActivities, next.agentActivities),
);

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
                className={`min-w-0 truncate ${
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
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-muted transition-transform duration-150 ${open ? "rotate-90" : ""}`}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
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

const FilesPanel = memo(function FilesPanel({ files, cwd }: { files: FileChange[]; cwd: string }) {
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
                        <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.8125rem] leading-snug transition-colors hover:bg-surface-hover">
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
    <div className="flex h-full flex-col">
      {/* Stats grid */}
      <div className="shrink-0 px-3.5 py-2.5">
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
            help="Session total based on the provider's reported input plus output usage. Cache reads may already be folded into input."
            value={formatTokens(totalTokens)}
          />
          <StatRow label="Messages" value={totalMessages} />
          <StatRow
            label="Input Tokens"
            help="Tokens sent in requests during this session. Some providers include cache-hit tokens here."
            value={formatTokens(stats.inputTokens)}
          />
          <StatRow
            label="Output Tokens"
            help="Tokens generated in model responses during this session."
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
          <StatRow label="Session Created" value={formatTimestamp(createdAt)} />
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
        <div className="flex min-h-0 flex-1 flex-col border-t border-border/30">
          <div className="shrink-0 px-3.5 py-2.5 text-[0.6875rem] text-muted">Raw Messages</div>
          <div className="flex-1 overflow-y-auto px-2 pb-2">
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

type SidecarTab = "team" | "tasks" | "files" | "context";

interface SidecarProps {
  tasks: TaskItem[] | null;
  files: FileChange[] | null;
  team: TeamInfo | null;
  agentActivities?: AgentActivity[] | null;
  stats?: SessionStats | null;
  items?: ChatItem[];
  rawHistory?: HistoryEntry[] | null;
  provider?: string;
  preferredModel?: string;
  instanceName?: string;
  createdAt?: number;
  lastActivityAt?: number;
  workingDirectory: string;
  onClose: () => void;
  isMobileOverlay?: boolean;
}

export const Sidecar = memo(
  function Sidecar({
    tasks,
    files,
    team,
    agentActivities,
    stats,
    items,
    rawHistory,
    provider,
    preferredModel,
    instanceName,
    createdAt,
    lastActivityAt,
    workingDirectory,
    onClose,
    isMobileOverlay,
  }: SidecarProps) {
    const hasTeam = !!team && team.members.length > 0;
    const hasAgentActivities = (agentActivities?.length ?? 0) > 0;
    const hasTasks = tasks && tasks.length > 0;
    const hasFiles = files && files.length > 0;
    const hasStats = !!stats && (stats.inputTokens > 0 || stats.outputTokens > 0);

    // Build available tabs in priority order: Team/Agents > Tasks > Files > Context
    const availableTabs = useMemo(() => {
      const tabs: { key: SidecarTab; label: string; count: number }[] = [];
      if (hasTeam || hasAgentActivities) {
        tabs.push({
          key: "team",
          label: hasTeam ? "Team" : "Agents",
          count: hasTeam ? team!.members.length : agentActivities!.length,
        });
      }
      if (hasTasks) tabs.push({ key: "tasks", label: "Tasks", count: tasks.length });
      if (hasFiles) tabs.push({ key: "files", label: "Files", count: files.length });
      if (hasStats) tabs.push({ key: "context", label: "Context", count: 0 });
      return tabs;
    }, [
      agentActivities,
      files,
      hasAgentActivities,
      hasFiles,
      hasTasks,
      hasTeam,
      hasStats,
      tasks,
      team,
    ]);

    const [activeTab, setActiveTab] = useState<SidecarTab>("team");

    // Resolve effective tab: if activeTab isn't available, fall back to first available
    const effectiveTab =
      availableTabs.find((t) => t.key === activeTab)?.key ?? availableTabs[0]?.key ?? "tasks";

    const panel = (
      <div
        className={
          isMobileOverlay
            ? "animate-slide-in-right flex h-full w-[85vw] max-w-sm flex-col rounded-l-2xl border-l border-border bg-surface shadow-2xl"
            : "flex h-full w-full flex-col border-l border-border/50 bg-surface"
        }
      >
        {/* Header */}
        <div className="shrink-0 px-3.5 pt-3 pb-2.5">
          <div className="flex items-center justify-between">
            {availableTabs.length > 1 ? (
              <Tabs.Root value={effectiveTab} onValueChange={(v) => setActiveTab(v as SidecarTab)}>
                <Tabs.List>
                  {availableTabs.map((tab) => (
                    <Tabs.Tab key={tab.key} value={tab.key}>
                      {tab.label}
                      {tab.count > 0 && (
                        <>
                          {" "}
                          <span className="inline-block min-w-[2ch] text-right tabular-nums opacity-60">
                            {tab.count}
                          </span>
                        </>
                      )}
                    </Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs.Root>
            ) : (
              <h2 className="text-[0.8125rem] font-semibold text-text-bright">
                {availableTabs[0]?.label ?? "Sidecar"}
              </h2>
            )}
            <Button variant="icon" size="icon-sm" onClick={onClose}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </Button>
          </div>
        </div>

        {/* Panel content */}
        {effectiveTab === "team" && (hasTeam || hasAgentActivities) && (
          <TeamPanel team={team} agentActivities={agentActivities} />
        )}
        {effectiveTab === "tasks" && hasTasks && <TasksPanel tasks={tasks} />}
        {effectiveTab === "files" && hasFiles && (
          <FilesPanel files={files} cwd={workingDirectory} />
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

    if (isMobileOverlay) {
      return (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
          <div className="animate-fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative h-full" onClick={(e) => e.stopPropagation()}>
            {panel}
          </div>
        </div>
      );
    }

    return panel;
  },
  (prev, next) => {
    return (
      prev.workingDirectory === next.workingDirectory &&
      prev.isMobileOverlay === next.isMobileOverlay &&
      prev.instanceName === next.instanceName &&
      prev.createdAt === next.createdAt &&
      prev.lastActivityAt === next.lastActivityAt &&
      prev.stats === next.stats &&
      prev.items === next.items &&
      prev.rawHistory === next.rawHistory &&
      prev.preferredModel === next.preferredModel &&
      sameTasks(prev.tasks, next.tasks) &&
      sameFiles(prev.files, next.files) &&
      sameTeam(prev.team, next.team) &&
      sameAgentActivities(prev.agentActivities, next.agentActivities)
    );
  },
);
