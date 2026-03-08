import { useState, useMemo } from "react";
import { Tabs } from "../ui/tabs";
import { Progress } from "../ui/progress";
import { Spinner } from "../ui/spinner";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import { Collapsible } from "../ui/collapsible";
import { FileIcon } from "../ui/file-icon";
import type { TaskItem, FileChange, TeamInfo, TeamMember, AgentActivity } from "@shared/types";

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

function TeamPanel({
  team,
  agentActivities,
}: {
  team: TeamInfo | null;
  agentActivities?: AgentActivity[] | null;
}) {
  const members = team?.members ?? [];
  const running = members.filter((m) => m.status === "running").length;
  const total = members.length;

  // Build a lookup from agentActivities for matching to members.
  // Agent IDs from progress events may not match member names directly,
  // so we show unmatched activities as a separate section.
  const activityByName = new Map<string, AgentActivity>();
  const unmatchedActivities: AgentActivity[] = [];
  if (agentActivities) {
    const memberNames = new Set(members.map((m) => m.name));
    for (const a of agentActivities) {
      if (memberNames.has(a.agentId)) {
        activityByName.set(a.agentId, a);
      } else {
        unmatchedActivities.push(a);
      }
    }
  }

  return (
    <>
      {/* Team header */}
      <div className="shrink-0 px-4 py-3">
        <div className="text-[0.8125rem] font-semibold text-text-bright">
          {team?.name ?? "Agents"}
        </div>
        {team?.description && (
          <div className="mt-0.5 text-[0.75rem] text-muted">{team.description}</div>
        )}
        <div className="mt-1.5 text-[0.75rem] font-medium text-muted">
          {total > 0 ? `${running}/${total} active` : `${unmatchedActivities.length} active`}
        </div>
      </div>

      {/* Member list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        <div className="flex flex-col gap-px">
          {members.map((member) => {
            const activity = activityByName.get(member.name);
            return (
              <div
                key={member.name}
                className="flex items-start gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] leading-snug"
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
                    {member.name}
                  </div>
                  <div className="truncate text-[0.75rem] text-muted">
                    {activity?.description || member.subagentType}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Unmatched agent activities (agentId doesn't match any member name) */}
          {unmatchedActivities.map((a) => (
            <div
              key={a.agentId}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] leading-snug"
            >
              <div className="mt-px">
                <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                  <Spinner size={14} />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-text">{a.agentId}</div>
                <div className="truncate text-[0.75rem] text-muted">
                  {a.description || "Working..."}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function TasksPanel({ tasks }: { tasks: TaskItem[] }) {
  const completed = tasks.filter((t) => t.status === "completed").length;
  const total = tasks.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;
  const allDone = completed === total;

  return (
    <>
      {/* Progress bar */}
      <div className="shrink-0 px-4 py-3">
        <div className="flex items-center justify-between pb-1.5">
          <span className={`text-[0.75rem] font-medium ${allDone ? "text-accent" : "text-muted"}`}>
            {completed}/{total} done
          </span>
        </div>
        <Progress value={progress} indicatorClass={allDone ? "bg-accent" : "bg-claude"} />
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        <div className="flex flex-col gap-px">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-start gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] leading-snug"
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
}

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

  return Array.from(map.entries()).map(([dir, dirFiles]) => {
    let additions = 0;
    let deletions = 0;
    let hasDiffStats = false;
    for (const { file } of dirFiles) {
      if (file.additions != null || file.deletions != null) {
        hasDiffStats = true;
        additions += file.additions ?? 0;
        deletions += file.deletions ?? 0;
      }
    }
    return {
      dir,
      files: dirFiles,
      totalEdits: dirFiles.reduce((sum, f) => sum + f.file.editCount, 0),
      additions,
      deletions,
      hasDiffStats,
    };
  });
}

function FilesPanel({ files, cwd }: { files: FileChange[]; cwd: string }) {
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
      <div className="shrink-0 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[0.75rem] font-medium tracking-wide text-muted">
            CHANGED FILES ({files.length})
            {hasDiffStats && (
              <span className="ml-1.5">
                <span className="text-muted/40">• </span>
                <span className="text-green-400">+{totalAdditions}</span>
                <span className="text-muted/40"> / </span>
                <span className="text-red-400">-{totalDeletions}</span>
              </span>
            )}
          </span>
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
                  <Collapsible.Trigger className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[0.8125rem] leading-snug hover:bg-hover transition-colors">
                    <ChevronIcon open={isOpen} />
                    <FileIcon path={group.dir} kind="directory" size={16} />
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
                  <div className={showDir ? "ml-3" : ""}>
                    {group.files.map(({ basename, file }) => (
                      <Tooltip key={file.path} content={relativePath(file.path, cwd)} side="left">
                        <div className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.8125rem] leading-snug hover:bg-hover transition-colors">
                          <FileIcon path={file.path} size={16} />
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
}

type SidecarTab = "team" | "tasks" | "files";

interface SidecarProps {
  tasks: TaskItem[] | null;
  files: FileChange[] | null;
  team: TeamInfo | null;
  agentActivities?: AgentActivity[] | null;
  workingDirectory: string;
  onClose: () => void;
  isMobileOverlay?: boolean;
}

export function Sidecar({
  tasks,
  files,
  team,
  agentActivities,
  workingDirectory,
  onClose,
  isMobileOverlay,
}: SidecarProps) {
  const hasTeam = !!team && team.members.length > 0;
  const hasAgentActivities = (agentActivities?.length ?? 0) > 0;
  const hasTasks = tasks && tasks.length > 0;
  const hasFiles = files && files.length > 0;

  // Build available tabs in priority order: Team/Agents > Tasks > Files
  const availableTabs: { key: SidecarTab; label: string; count: number }[] = [];
  if (hasTeam || hasAgentActivities) {
    availableTabs.push({
      key: "team",
      label: hasTeam ? "Team" : "Agents",
      count: hasTeam ? team!.members.length : agentActivities!.length,
    });
  }
  if (hasTasks) availableTabs.push({ key: "tasks", label: "Tasks", count: tasks.length });
  if (hasFiles) availableTabs.push({ key: "files", label: "Files", count: files.length });

  const [activeTab, setActiveTab] = useState<SidecarTab>("team");

  // Resolve effective tab: if activeTab isn't available, fall back to first available
  const effectiveTab =
    availableTabs.find((t) => t.key === activeTab)?.key ?? availableTabs[0]?.key ?? "tasks";

  const panel = (
    <div
      className={
        isMobileOverlay
          ? "animate-slide-in-right flex h-full w-[85vw] max-w-sm flex-col border-l border-border bg-surface"
          : "flex h-full w-full flex-col border-l border-border"
      }
    >
      {/* Header */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          {availableTabs.length > 1 ? (
            <Tabs.Root value={effectiveTab} onValueChange={(v) => setActiveTab(v as SidecarTab)}>
              <Tabs.List>
                {availableTabs.map((tab) => (
                  <Tabs.Tab key={tab.key} value={tab.key}>
                    {tab.label} ({tab.count})
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
      {effectiveTab === "files" && hasFiles && <FilesPanel files={files} cwd={workingDirectory} />}
    </div>
  );

  if (isMobileOverlay) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
        <div className="animate-fade-in absolute inset-0 bg-black/50" />
        <div className="relative h-full" onClick={(e) => e.stopPropagation()}>
          {panel}
        </div>
      </div>
    );
  }

  return panel;
}
