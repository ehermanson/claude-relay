import { useState } from "react";
import { Tabs } from "../ui/tabs";
import { Progress } from "../ui/progress";
import { Spinner } from "../ui/spinner";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import type { TaskItem, FileChange, TeamInfo, TeamMember } from "@shared/types";

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

function FileIcon({ type }: { type: FileChange["type"] }) {
  if (type === "added") {
    // Plus icon
    return (
      <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-accent">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </div>
    );
  }
  // Pencil icon for edited
  return (
    <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-muted">
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        <path d="m15 5 4 4" />
      </svg>
    </div>
  );
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

function TeamPanel({ team }: { team: TeamInfo }) {
  const running = team.members.filter((m) => m.status === "running").length;
  const total = team.members.length;

  return (
    <>
      {/* Team header */}
      <div className="shrink-0 px-4 py-3">
        <div className="text-[0.8125rem] font-semibold text-text-bright">{team.name}</div>
        {team.description && (
          <div className="mt-0.5 text-[0.75rem] text-muted">{team.description}</div>
        )}
        <div className="mt-1.5 text-[0.75rem] font-medium text-muted">
          {running}/{total} active
        </div>
      </div>

      {/* Member list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        <div className="flex flex-col gap-px">
          {team.members.map((member) => (
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
                <div className="truncate text-[0.75rem] text-muted">{member.subagentType}</div>
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

function FilesPanel({ files, cwd }: { files: FileChange[]; cwd: string }) {
  return (
    <>
      {/* File count */}
      <div className="shrink-0 px-4 py-3">
        <span className="text-[0.75rem] font-medium text-muted">
          {files.length} file{files.length !== 1 ? "s" : ""} changed
        </span>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        <div className="flex flex-col gap-px">
          {files.map((file) => {
            const rel = relativePath(file.path, cwd);
            const parts = rel.split("/");
            const basename = parts.pop() || rel;
            const dir = parts.join("/");

            return (
              <Tooltip content={rel} side="left">
                <div
                  key={file.path}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] leading-snug"
                >
                  <FileIcon type={file.type} />
                  <div className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-text">{basename}</span>
                    {dir && <span className="ml-1 text-[0.75rem] text-muted">{dir}/</span>}
                  </div>
                  {file.editCount > 1 && (
                    <span className="shrink-0 text-[0.6875rem] font-medium text-muted">
                      ×{file.editCount}
                    </span>
                  )}
                </div>
              </Tooltip>
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
  workingDirectory: string;
  onClose: () => void;
  isMobileOverlay?: boolean;
}

export function Sidecar({
  tasks,
  files,
  team,
  workingDirectory,
  onClose,
  isMobileOverlay,
}: SidecarProps) {
  const hasTeam = team && team.members.length > 0;
  const hasTasks = tasks && tasks.length > 0;
  const hasFiles = files && files.length > 0;

  // Build available tabs in priority order: Team > Tasks > Files
  const availableTabs: { key: SidecarTab; label: string; count: number }[] = [];
  if (hasTeam) availableTabs.push({ key: "team", label: "Team", count: team.members.length });
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
      {effectiveTab === "team" && hasTeam && <TeamPanel team={team} />}
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
