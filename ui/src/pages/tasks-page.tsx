import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownNarrowWide, Ban, Check, ChevronLeft, Plus } from "lucide-react";
import { MarkdownContent } from "@/components/chat/markdown-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Menu } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { useProjectContext } from "@/context/project-context";
import { useWSMethods } from "@/context/websocket-context";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { Task, TaskStatus, TaskType, TasksChangedMessage } from "@shared/types";
import { fetchTasks, createTaskApi, updateTaskApi, deleteTaskApi, initTasksApi } from "@/lib/api";
import { formatTimeAgo } from "@/lib/utils";
import { patchTasksSearch } from "@/routes/_app/projects/$projectId/tasks/-search";

// ─── Constants ──────────────────────────────────────────────────────────────

const priorityLabels: Record<number, string> = {
  0: "P0",
  1: "P1",
  2: "P2",
  3: "P3",
  4: "P4",
};

const priorityVariants: Record<number, "error" | "warning" | "accent" | "default"> = {
  0: "error",
  1: "warning",
  2: "accent",
  3: "default",
  4: "default",
};

const statusLabels: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
};

const statusVariants: Record<string, "accent" | "warning" | "error" | "default" | "success"> = {
  open: "accent",
  in_progress: "warning",
  blocked: "error",
  done: "success",
};

const statusDotColors: Record<string, string> = {
  open: "bg-accent",
  in_progress: "bg-warning",
  blocked: "bg-error",
  done: "bg-accent",
};

const typeLabels: Record<string, string> = {
  epic: "Epic",
  task: "Task",
  bug: "Bug",
};

function StatusIcon({ status, size = 14 }: { status: string; size?: number }) {
  switch (status) {
    case "open":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="text-accent">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2.5} />
        </svg>
      );
    case "in_progress":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="text-warning">
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeDasharray="14 8"
            strokeLinecap="round"
          />
        </svg>
      );
    case "blocked":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-error"
        >
          <circle cx="12" cy="12" r="9" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
      );
    case "done":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="text-accent">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={2.5} />
          <polyline
            points="8 12 11 15 16 9"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return <span className={`h-2 w-2 rounded-full ${statusDotColors[status] ?? "bg-muted"}`} />;
  }
}

const STATUS_ORDER: TaskStatus[] = ["open", "in_progress", "blocked", "done"];

/** Cycle through statuses for inline clicking (skip blocked — it's auto-derived) */
const CYCLE_STATUSES: TaskStatus[] = ["open", "in_progress", "done"];

type SortKey = "priority" | "updated" | "type" | "created";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "priority", label: "Priority" },
  { key: "updated", label: "Recently updated" },
  { key: "created", label: "Recently created" },
  { key: "type", label: "Type" },
];

function sortTasks(tasks: Task[], sortKey: SortKey): Task[] {
  return [...tasks].sort((a, b) => {
    switch (sortKey) {
      case "priority":
        return a.priority - b.priority;
      case "updated":
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      case "created":
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case "type":
        return a.type.localeCompare(b.type);
      default:
        return 0;
    }
  });
}

function getColumnSortKey(status: TaskStatus, boardSort: SortKey): SortKey {
  return status === "done" ? "updated" : boardSort;
}

// ─── Task Card ──────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onClick,
  onCycleStatus,
}: {
  task: Task;
  onClick: () => void;
  onCycleStatus: () => void;
}) {
  const timeAgo = formatTimeAgo(task.updatedAt);
  const blockerCount = task.blockedBy?.length ?? 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="w-full cursor-pointer rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-border-bright hover:bg-surface-hover"
    >
      <div className="mb-1 flex items-start gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCycleStatus();
          }}
          className="mt-0.5 shrink-0 transition-transform hover:scale-110"
          title={`Status: ${statusLabels[task.status] ?? task.status}`}
        >
          <StatusIcon status={task.status} size={14} />
        </button>
        <span className="text-[0.8125rem] font-medium leading-snug text-text-bright">
          {task.title}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-[22px]">
        <span className="shrink-0 font-mono text-[0.5625rem] text-muted/70">{task.id}</span>
        <Badge variant={priorityVariants[task.priority] ?? "default"} size="sm">
          {priorityLabels[task.priority] ?? `P${task.priority}`}
        </Badge>
        <Badge size="sm">{typeLabels[task.type] ?? task.type}</Badge>
        {task.tags?.map((tag) => (
          <Badge key={tag} size="sm" variant="default">
            {tag}
          </Badge>
        ))}
        {blockerCount > 0 && (
          <Tooltip content={`Blocked by ${blockerCount} task${blockerCount !== 1 ? "s" : ""}`}>
            <span className="inline-flex items-center gap-0.5 text-[0.5625rem] text-muted">
              <Ban size={9} />
              {blockerCount}
            </span>
          </Tooltip>
        )}
        <span className="ml-auto shrink-0 text-[0.5625rem] text-muted/70">{timeAgo}</span>
      </div>
    </div>
  );
}

// ─── Task Drawer Content ────────────────────────────────────────────────────

function TaskDrawerBody({
  task,
  allTasks,
  onSelectTask,
  onUpdate,
  onDelete,
  showBack,
  onBack,
}: {
  task: Task;
  allTasks: Task[];
  onSelectTask: (id: string) => void;
  onUpdate: (taskId: string, patch: Partial<Task>) => void;
  onDelete: (taskId: string) => void;
  showBack?: boolean;
  onBack?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(task.title);
  const [editDescription, setEditDescription] = useState(task.description);
  const [editPriority, setEditPriority] = useState(task.priority);
  const [editType, setEditType] = useState(task.type);
  const [editTags, setEditTags] = useState(task.tags?.join(", ") ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSave = () => {
    const tags = editTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    onUpdate(task.id, {
      title: editTitle,
      description: editDescription,
      priority: editPriority,
      type: editType,
      tags,
    });
    setEditing(false);
  };

  // Find blockers and dependents from all tasks
  const blockers = allTasks.filter((t) => task.blockedBy?.includes(t.id));
  const dependents = allTasks.filter((t) => t.blockedBy?.includes(task.id));
  const children = allTasks.filter((t) => t.parent === task.id);
  const parentTask = task.parent ? allTasks.find((t) => t.id === task.parent) : null;

  return (
    <>
      <Drawer.Header className="items-start">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {showBack && (
            <button
              type="button"
              onClick={onBack}
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              <ChevronLeft size={14} />
            </button>
          )}
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full rounded border border-border bg-surface-hover px-2 py-1 text-sm font-semibold text-text-bright outline-none focus:border-accent"
              />
            ) : (
              <Drawer.Title>{task.title}</Drawer.Title>
            )}
            <span className="shrink-0 font-mono text-xs text-muted">{task.id}</span>
          </div>
        </div>
        <Drawer.Close />
      </Drawer.Header>
      <Drawer.Body className="px-5 py-4">
        {/* Status + metadata badges */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Menu.Root>
            <Menu.Trigger>
              <Badge variant={statusVariants[task.status] ?? "default"} className="cursor-pointer">
                {statusLabels[task.status] ?? task.status}
              </Badge>
            </Menu.Trigger>
            <Menu.Content>
              {STATUS_ORDER.filter((s) => s !== "blocked").map((s) => (
                <Menu.Item key={s} onClick={() => onUpdate(task.id, { status: s })}>
                  <StatusIcon status={s} size={12} />
                  <span className="flex-1">{statusLabels[s]}</span>
                  {task.status === s && <Check size={14} className="shrink-0" />}
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Root>
          {editing ? (
            <>
              <select
                value={editPriority}
                onChange={(e) => setEditPriority(Number(e.target.value))}
                className="rounded border border-border bg-surface-hover px-2 py-0.5 text-xs text-text outline-none"
              >
                {[0, 1, 2, 3, 4].map((p) => (
                  <option key={p} value={p}>
                    {priorityLabels[p]}
                  </option>
                ))}
              </select>
              <select
                value={editType}
                onChange={(e) => setEditType(e.target.value as TaskType)}
                className="rounded border border-border bg-surface-hover px-2 py-0.5 text-xs text-text outline-none"
              >
                {(["epic", "task", "bug"] as TaskType[]).map((t) => (
                  <option key={t} value={t}>
                    {typeLabels[t]}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <Badge variant={priorityVariants[task.priority] ?? "default"}>
                {priorityLabels[task.priority] ?? `P${task.priority}`}
              </Badge>
              <Badge>{typeLabels[task.type] ?? task.type}</Badge>
            </>
          )}
        </div>

        {/* Tags */}
        {editing ? (
          <div className="mb-4">
            <label className="mb-1 block text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              className="w-full rounded border border-border bg-surface-hover px-2 py-1 text-xs text-text outline-none focus:border-accent"
              placeholder="e.g. ui, perf, backend"
            />
          </div>
        ) : (
          task.tags &&
          task.tags.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1">
              {task.tags.map((tag) => (
                <Badge key={tag} size="sm" variant="default">
                  {tag}
                </Badge>
              ))}
            </div>
          )
        )}

        {/* Parent */}
        {parentTask && (
          <div className="mb-4">
            <h4 className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">
              Parent
            </h4>
            <button
              type="button"
              onClick={() => onSelectTask(parentTask.id)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
            >
              <StatusIcon status={parentTask.status} size={12} />
              <span className="font-mono text-[0.625rem] text-muted">{parentTask.id}</span>
              <span className="truncate text-[0.8125rem] text-text-bright">{parentTask.title}</span>
            </button>
          </div>
        )}

        {/* Children */}
        {children.length > 0 && (
          <div className="mb-4">
            <h4 className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">
              Children
            </h4>
            <div className="flex flex-col gap-1">
              {children.map((child) => (
                <button
                  key={child.id}
                  type="button"
                  onClick={() => onSelectTask(child.id)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
                >
                  <StatusIcon status={child.status} size={12} />
                  <span className="font-mono text-[0.625rem] text-muted">{child.id}</span>
                  <span className="truncate text-[0.8125rem] text-text-bright">{child.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Blockers */}
        {blockers.length > 0 && (
          <div className="mb-4">
            <h4 className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">
              Blocked by
            </h4>
            <div className="flex flex-col gap-1">
              {blockers.map((dep) => (
                <button
                  key={dep.id}
                  type="button"
                  onClick={() => onSelectTask(dep.id)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
                >
                  <StatusIcon status={dep.status} size={12} />
                  <span className="font-mono text-[0.625rem] text-muted">{dep.id}</span>
                  <span className="truncate text-[0.8125rem] text-text-bright">{dep.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Dependents */}
        {dependents.length > 0 && (
          <div className="mb-4">
            <h4 className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">
              Blocks
            </h4>
            <div className="flex flex-col gap-1">
              {dependents.map((dep) => (
                <button
                  key={dep.id}
                  type="button"
                  onClick={() => onSelectTask(dep.id)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
                >
                  <StatusIcon status={dep.status} size={12} />
                  <span className="font-mono text-[0.625rem] text-muted">{dep.id}</span>
                  <span className="truncate text-[0.8125rem] text-text-bright">{dep.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4 text-[0.6875rem] text-muted">
          Updated {formatTimeAgo(task.updatedAt)}
        </div>

        {/* Description */}
        {editing ? (
          <div className="mb-4">
            <label className="mb-1 block text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">
              Description
            </label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={6}
              className="w-full rounded border border-border bg-surface-hover px-2 py-1.5 text-sm text-text outline-none focus:border-accent"
              placeholder="Markdown description..."
            />
          </div>
        ) : task.description ? (
          <div className="prose-sm text-sm">
            <MarkdownContent text={task.description} />
          </div>
        ) : (
          <p className="text-sm text-muted italic">No description</p>
        )}

        {/* Action buttons */}
        <div className="mt-6 flex items-center gap-2 border-t border-border pt-4">
          {editing ? (
            <>
              <Button size="sm" onClick={handleSave}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          <div className="flex-1" />
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-error">Delete this task?</span>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-error hover:text-error"
                onClick={() => onDelete(task.id)}
              >
                Delete
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted hover:text-error"
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </Drawer.Body>
    </>
  );
}

// ─── Stacked Drawer ─────────────────────────────────────────────────────────

interface StackItem {
  key: string;
  taskId: string;
  open: boolean;
}

function StackedDrawer({
  item,
  task,
  allTasks,
  isFirst,
  reversedPosition,
  onClose,
  onSelectTask,
  onUpdate,
  onDelete,
}: {
  item: StackItem;
  task: Task | null;
  allTasks: Task[];
  isFirst: boolean;
  reversedPosition: number;
  onClose: () => void;
  onSelectTask: (id: string) => void;
  onUpdate: (taskId: string, patch: Partial<Task>) => void;
  onDelete: (taskId: string) => void;
}) {
  const lastTask = useRef<Task | null>(null);
  if (task) lastTask.current = task;
  const display = task ?? lastTask.current;

  const isClosing = !item.open;
  const stackStyle: React.CSSProperties =
    reversedPosition > 0 && !isClosing
      ? {
          transform: `translateX(${-reversedPosition * 20}px) scale(${1 - reversedPosition * 0.03})`,
          opacity: Math.max(1 - reversedPosition * 0.04, 0.85),
        }
      : {};

  return (
    <Drawer.Root open={item.open} onOpenChange={(o) => !o && onClose()}>
      <Drawer.Content showBackdrop={isFirst} style={stackStyle}>
        {display && (
          <TaskDrawerBody
            key={display.id}
            task={display}
            allTasks={allTasks}
            onSelectTask={onSelectTask}
            onUpdate={onUpdate}
            onDelete={onDelete}
            showBack={!isFirst}
            onBack={onClose}
          />
        )}
      </Drawer.Content>
    </Drawer.Root>
  );
}

// ─── Kanban Column ──────────────────────────────────────────────────────────

function KanbanColumn({
  status,
  tasks,
  mobile,
  onSelectTask,
  onCycleStatus,
}: {
  status: string;
  tasks: Task[];
  mobile?: boolean;
  onSelectTask: (id: string) => void;
  onCycleStatus: (task: Task) => void;
}) {
  if (tasks.length === 0) return null;

  const label = statusLabels[status] ?? status;

  return (
    <div className={mobile ? "flex flex-col" : "flex min-w-[280px] max-w-[320px] flex-1 flex-col"}>
      <div className="mb-2 flex items-center gap-2 px-1">
        <StatusIcon status={status} size={14} />
        <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">
          {label}
        </h3>
        <span className="text-[0.625rem] text-muted/60">{tasks.length}</span>
      </div>
      <div
        className={
          mobile ? "flex flex-col gap-2" : "flex flex-1 flex-col gap-2 overflow-y-auto pr-1"
        }
      >
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onClick={() => onSelectTask(task.id)}
            onCycleStatus={() => onCycleStatus(task)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Create Task Form ───────────────────────────────────────────────────────

function CreateTaskForm({
  projectId,
  allTasks,
  onCreated,
}: {
  projectId: string;
  allTasks: Task[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(2);
  const [type, setType] = useState<TaskType>("task");
  const [tags, setTags] = useState("");
  const [parent, setParent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setTitle("");
    setDescription("");
    setPriority(2);
    setType("task");
    setTags("");
    setParent("");
    setError("");
  };

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await createTaskApi(projectId, {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        type,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        parent: parent || null,
      });
      reset();
      setOpen(false);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[0.75rem] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text"
      >
        <Plus size={14} />
        New Task
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title"
        className="mb-2 w-full rounded border border-border bg-surface-hover px-2 py-1.5 text-sm text-text-bright outline-none focus:border-accent"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) handleSubmit();
          if (e.key === "Escape") {
            reset();
            setOpen(false);
          }
        }}
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (markdown)"
        rows={3}
        className="mb-2 w-full rounded border border-border bg-surface-hover px-2 py-1.5 text-xs text-text outline-none focus:border-accent"
      />
      <div className="mb-2 flex flex-wrap gap-2">
        <select
          value={priority}
          onChange={(e) => setPriority(Number(e.target.value))}
          className="rounded border border-border bg-surface-hover px-2 py-1 text-xs text-text outline-none"
        >
          {[0, 1, 2, 3, 4].map((p) => (
            <option key={p} value={p}>
              {priorityLabels[p]}
            </option>
          ))}
        </select>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as TaskType)}
          className="rounded border border-border bg-surface-hover px-2 py-1 text-xs text-text outline-none"
        >
          {(["task", "epic", "bug"] as TaskType[]).map((t) => (
            <option key={t} value={t}>
              {typeLabels[t]}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Tags (comma-sep)"
          className="rounded border border-border bg-surface-hover px-2 py-1 text-xs text-text outline-none"
        />
        {allTasks.length > 0 && (
          <select
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            className="rounded border border-border bg-surface-hover px-2 py-1 text-xs text-text outline-none"
          >
            <option value="">No parent</option>
            {allTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} — {t.title}
              </option>
            ))}
          </select>
        )}
      </div>
      {error && <p className="mb-2 text-xs text-error">{error}</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSubmit} disabled={submitting || !title.trim()}>
          {submitting ? "Creating..." : "Create"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function TasksPage() {
  const { artifacts } = useProjectContext();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { task: selectedId, sort: sortParam } = useSearch({
    from: "/_app/projects/$projectId/tasks/",
  });
  const navigate = useNavigate({ from: "/projects/$projectId/tasks/" });
  const [stack, setStack] = useState<StackItem[]>([]);
  const [snippet, setSnippet] = useState<string | null>(null);
  const projectId = artifacts.projectId;
  const { addMessageHandler } = useWSMethods();
  const queryClient = useQueryClient();

  const { data: tasks = artifacts.tasks } = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => fetchTasks(projectId),
    initialData: artifacts.tasks,
  });

  const currentSort: SortKey =
    sortParam && SORT_OPTIONS.some((o) => o.key === sortParam)
      ? (sortParam as SortKey)
      : "priority";

  // Invalidate query on WebSocket task updates
  useEffect(() => {
    return addMessageHandler((msg) => {
      if (msg.type === "tasks_changed" && (msg as TasksChangedMessage).projectId === projectId) {
        queryClient.setQueryData(["tasks", projectId], (msg as TasksChangedMessage).tasks);
      }
    });
  }, [addMessageHandler, projectId, queryClient]);

  const refreshTasks = async () => {
    await queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
  };

  const handleUpdate = async (taskId: string, patch: Partial<Task>) => {
    try {
      await updateTaskApi(projectId, taskId, patch);
      await refreshTasks();
    } catch (e) {
      // Could add toast notification here
      console.error("Failed to update task:", e);
    }
  };

  const handleDelete = async (taskId: string) => {
    try {
      await deleteTaskApi(projectId, taskId);
      // Close drawers
      setStack([]);
      navigate({ search: {} });
      await refreshTasks();
    } catch (e) {
      console.error("Failed to delete task:", e);
    }
  };

  const handleCycleStatus = (task: Task) => {
    const currentIdx = CYCLE_STATUSES.indexOf(task.status as TaskStatus);
    const nextStatus = CYCLE_STATUSES[(currentIdx + 1) % CYCLE_STATUSES.length];
    handleUpdate(task.id, { status: nextStatus });
  };

  // Sync URL → stack (initial load, browser back/forward)
  useEffect(() => {
    if (selectedId) {
      setStack((prev) => {
        if (prev.length === 0 || prev[0].taskId !== selectedId) {
          return [{ key: "base", taskId: selectedId, open: true }];
        }
        return prev;
      });
    } else {
      setStack([]);
    }
  }, [selectedId]);

  const selectTask = (id: string) => {
    setStack([{ key: "base", taskId: id, open: true }]);
    navigate({ search: { task: id } });
  };

  const pushDrawer = (taskId: string) => {
    setStack((prev) => {
      const top = prev[prev.length - 1];
      if (top?.taskId === taskId) return prev;
      const key = `stacked-${Date.now()}`;
      return [...prev, { key, taskId, open: false }];
    });
    requestAnimationFrame(() => {
      setStack((prev) => {
        const last = prev[prev.length - 1];
        if (last && !last.open) {
          return prev.map((s, i) => (i === prev.length - 1 ? { ...s, open: true } : s));
        }
        return prev;
      });
    });
  };

  const popAt = (idx: number) => {
    if (idx === 0) {
      setStack((prev) => prev.map((s) => ({ ...s, open: false })));
      setTimeout(() => {
        setStack([]);
        navigate({ search: {} });
      }, 200);
    } else {
      setStack((prev) => prev.map((s, i) => (i >= idx ? { ...s, open: false } : s)));
      setTimeout(() => {
        setStack((prev) => prev.slice(0, idx));
      }, 200);
    }
  };

  // ─── Empty state: init tasks or migrate ─────────────────────────────────

  if (!tasks) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <p className="mb-1 text-sm text-muted">No tasks initialized</p>
        <Button
          size="sm"
          onClick={async () => {
            try {
              const result = await initTasksApi(projectId);
              setSnippet(result.snippet);
              await queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
            } catch (e) {
              console.error("Failed to init tasks:", e);
            }
          }}
        >
          Initialize Tasks
        </Button>
        {snippet && (
          <div className="mt-4 w-full max-w-lg text-left">
            <p className="mb-2 text-xs text-muted">
              Add this to your CLAUDE.md or AGENTS.md so models know about tasks:
            </p>
            <div className="relative rounded-md border border-border bg-surface p-3">
              <pre className="overflow-x-auto text-xs text-text">{snippet}</pre>
              <button
                type="button"
                className="absolute top-2 right-2 rounded px-1.5 py-0.5 text-[0.625rem] text-muted transition-colors hover:bg-surface-hover hover:text-text"
                onClick={() => navigator.clipboard.writeText(snippet)}
              >
                Copy
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Empty tasks (initialized but no tasks yet) ─────────────────────────

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-10">
        <p className="text-sm text-muted">No tasks yet</p>
        <div className="w-full max-w-md px-4">
          <CreateTaskForm projectId={projectId} allTasks={[]} onCreated={refreshTasks} />
        </div>
      </div>
    );
  }

  // ─── Kanban view ────────────────────────────────────────────────────────

  const setSort = (key: SortKey) => {
    navigate({
      search: patchTasksSearch({
        sort: key === "priority" ? undefined : key,
      }),
      replace: true,
    });
  };

  const grouped = Object.fromEntries(
    STATUS_ORDER.map((s) => [
      s,
      sortTasks(
        tasks.filter((t) => t.status === s),
        getColumnSortKey(s, currentSort),
      ),
    ]),
  );

  const sortLabel = SORT_OPTIONS.find((o) => o.key === currentSort)?.label ?? "Priority";

  const openItems = stack.filter((s) => s.open);
  const drawerStack = stack.map((item, idx) => {
    const task = tasks.find((t) => t.id === item.taskId) ?? null;
    const posInOpen = openItems.findIndex((s) => s.key === item.key);
    const reversedPos = posInOpen >= 0 ? openItems.length - posInOpen - 1 : 0;

    return (
      <StackedDrawer
        key={item.key}
        item={item}
        task={task}
        allTasks={tasks}
        isFirst={idx === 0}
        reversedPosition={reversedPos}
        onClose={() => popAt(idx)}
        onSelectTask={pushDrawer}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    );
  });

  const sortMenu = (
    <Menu.Root>
      <Menu.Trigger className="flex items-center gap-1 rounded-md px-2 py-1 text-[0.75rem] font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text">
        <ArrowDownNarrowWide size={12} />
        {sortLabel}
      </Menu.Trigger>
      <Menu.Content>
        {SORT_OPTIONS.map((option) => (
          <Menu.Item key={option.key} onClick={() => setSort(option.key)}>
            <span className="flex-1">{option.label}</span>
            {currentSort === option.key && (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Root>
  );

  if (isMobile) {
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <CreateTaskForm projectId={projectId} allTasks={tasks} onCreated={refreshTasks} />
          {sortMenu}
        </div>
        <div className="flex flex-col gap-6 px-4 py-2">
          {STATUS_ORDER.map((s) => (
            <KanbanColumn
              key={s}
              status={s}
              tasks={grouped[s]}
              mobile
              onSelectTask={selectTask}
              onCycleStatus={handleCycleStatus}
            />
          ))}
        </div>
        {drawerStack}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 pt-3 pb-1">
        <CreateTaskForm projectId={projectId} allTasks={tasks} onCreated={refreshTasks} />
        {sortMenu}
      </div>
      <div className="flex flex-1 gap-4 overflow-x-auto px-6 py-2">
        {STATUS_ORDER.map((s) => (
          <KanbanColumn
            key={s}
            status={s}
            tasks={grouped[s]}
            onSelectTask={selectTask}
            onCycleStatus={handleCycleStatus}
          />
        ))}
      </div>
      {drawerStack}
    </div>
  );
}
