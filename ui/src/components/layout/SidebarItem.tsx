import { useCallback } from "react";
import { formatTimeAgo } from "../../lib/utils";
import type { InstanceInfo } from "@shared/types";

interface SidebarItemProps {
  instance: InstanceInfo;
  isActive: boolean;
  onClick: () => void;
  onDelete?: () => void;
}

export function SidebarItem({
  instance,
  isActive,
  onClick,
  onDelete,
}: SidebarItemProps) {
  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete?.();
    },
    [onDelete]
  );

  const isWaiting = instance.waitingForInput && instance.status === "idle";

  return (
    <div
      onClick={onClick}
      className={`group flex cursor-pointer items-center gap-2 border-b border-b-border-subtle py-2 pl-7 pr-4 transition-all ${
        isActive
          ? "bg-accent-dim"
          : "hover:bg-surface-hover"
      }`}
    >
      <span
        className={`h-[7px] w-[7px] shrink-0 rounded-full ${
          instance.status === "idle"
            ? isWaiting
              ? "animate-ring-pulse bg-success shadow-[0_0_6px_var(--color-accent-glow)]"
              : "bg-success shadow-[0_0_6px_var(--color-accent-glow)]"
            : instance.status === "processing"
              ? "animate-pulse-dot bg-warning shadow-[0_0_6px_var(--color-warning-glow)]"
              : instance.status === "error"
                ? "bg-error shadow-[0_0_6px_var(--color-error-dim)]"
                : "bg-muted"
        }`}
      />
      <span
        className={`min-w-0 flex-1 truncate text-[0.8125rem] font-semibold ${
          isActive ? "text-accent" : "text-text-bright"
        }`}
      >
        {instance.name}
      </span>
      {instance.lastMessage && (
        <span className="shrink-0 text-[0.5625rem] text-muted opacity-70">
          {formatTimeAgo(instance.lastMessage.timestamp)}
        </span>
      )}
      {!instance.external && onDelete && (
        <button
          onClick={handleDelete}
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-sm border border-transparent bg-transparent text-muted opacity-0 transition-all group-hover:opacity-60 hover:!border-error hover:!text-error hover:!opacity-100"
        >
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}
