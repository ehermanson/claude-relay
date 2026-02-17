import type { TaskItem } from "@shared/types";

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
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            className="animate-spin text-claude"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeDasharray="50 20"
              strokeLinecap="round"
            />
          </svg>
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

interface TaskListDisplayProps {
  tasks: TaskItem[];
}

export function TaskListDisplay({ tasks }: TaskListDisplayProps) {
  return (
    <div className="animate-fade-in flex flex-col gap-px">
      {tasks.map((task) => (
        <div
          key={task.id}
          className="flex items-center gap-2 rounded-md px-2.5 py-1 text-[0.8125rem] leading-snug"
        >
          <StatusIcon status={task.status} />
          <span
            className={`${task.status === "completed" ? "text-muted line-through" : "text-text"}`}
          >
            {task.status === "in_progress" && task.activeForm ? task.activeForm : task.subject}
          </span>
        </div>
      ))}
    </div>
  );
}
