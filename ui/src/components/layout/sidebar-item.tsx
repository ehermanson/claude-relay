import { useState, useRef, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Menu } from "../ui/menu";
import { Tooltip } from "../ui/tooltip";
import { formatTimeAgo } from "../../lib/utils";
import type { InstanceInfo } from "@shared/types";

interface SidebarItemProps {
  instance: InstanceInfo;
  isActive: boolean;
  isChild?: boolean;
  parentInstance?: { id: string; name: string };
  onClick: () => void;
  onDelete?: () => void;
  deleteDisabled?: boolean;
  onRefreshTitle?: () => void;
  onRename?: (name: string) => void;
  onMerge?: () => void;
}

export function SidebarItem({
  instance,
  isActive,
  isChild,
  parentInstance,
  onClick,
  onDelete,
  deleteDisabled,
  onRefreshTitle,
  onRename,
  onMerge,
}: SidebarItemProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const hasMenu = !!onDelete || !!onRefreshTitle || !!onRename || !!onMerge;

  // Focus input when entering edit mode
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEditing = () => {
    setEditValue(instance.name);
    setEditing(true);
  };

  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== instance.name) {
      onRename?.(trimmed);
    }
    setEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      commitEdit();
    } else if (e.key === "Escape") {
      setEditing(false);
    }
  };

  const hasPendingTool = !!instance.pendingTool;

  return (
    <div
      onClick={editing ? undefined : onClick}
      className={`group relative flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 transition-colors ${
        isChild ? "pl-7" : ""
      } ${isActive ? "bg-accent-dim text-accent" : "text-text hover:bg-surface-hover"}`}
    >
      {/* Status dot */}
      <span
        className={`h-[6px] w-[6px] shrink-0 rounded-full ${
          hasPendingTool
            ? "animate-pulse-dot bg-warning"
            : instance.status === "idle"
              ? "bg-accent"
              : instance.status === "processing"
                ? "animate-pulse-dot bg-warning"
                : instance.status === "error"
                  ? "bg-error"
                  : "bg-muted"
        }`}
      />

      {/* Name + preview */}
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleEditKeyDown}
            onBlur={commitEdit}
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded border border-border bg-surface px-1 py-0.5 text-[0.8125rem] font-medium leading-tight text-text-bright outline-none focus:border-accent"
          />
        ) : (
          <div
            className={`truncate text-[0.8125rem] font-medium leading-tight ${
              isActive ? "text-accent" : "text-text-bright"
            }`}
          >
            {instance.name}
          </div>
        )}
        {!editing && instance.gitBranch && (
          <div className="mt-0.5 flex items-center gap-1 truncate text-[0.6875rem] leading-tight text-accent/70">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <span className="truncate">{instance.gitBranch}</span>
          </div>
        )}
        {!editing && isChild && parentInstance && (
          <Tooltip content={`Continued from "${parentInstance.name}"`} side="bottom">
            <button
              onClick={(e) => {
                e.stopPropagation();
                const projectId =
                  instance.workingDirectory.split("/").pop() || instance.workingDirectory;
                navigate({
                  to: "/projects/$projectId/chats/$chatId",
                  params: { projectId, chatId: parentInstance.id },
                });
              }}
              className="mt-0.5 max-w-full truncate text-[0.6875rem] leading-tight text-muted transition-colors hover:text-accent"
            >
              <span className="mr-0.5">{"\u21B3"}</span> from {parentInstance.name}
            </button>
          </Tooltip>
        )}
        {!editing && instance.lastMessage && (
          <div className="mt-0.5 truncate text-[0.6875rem] leading-tight text-muted">
            {instance.lastMessage.text}
          </div>
        )}
      </div>

      {/* Timestamp */}
      {!editing && instance.lastMessage && (
        <span className="shrink-0 self-start pt-0.5 text-[0.625rem] text-muted opacity-60">
          {formatTimeAgo(instance.lastMessage.timestamp)}
        </span>
      )}

      {/* Context menu — only mount when open to avoid Menu overhead per item */}
      {hasMenu &&
        !editing &&
        (menuOpen ? (
          <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Menu.Trigger
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted opacity-100 transition-all hover:!text-text"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </Menu.Trigger>
            <Menu.Content>
              {onRename && (
                <Menu.Item
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    startEditing();
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-muted"
                  >
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                  Rename
                </Menu.Item>
              )}
              {onRefreshTitle && (
                <Menu.Item
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    onRefreshTitle();
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-muted"
                  >
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  Refresh title
                </Menu.Item>
              )}
              {onMerge && (
                <Menu.Item
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    onMerge();
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-muted"
                  >
                    <circle cx="18" cy="18" r="3" />
                    <circle cx="6" cy="6" r="3" />
                    <path d="M6 21V9a9 9 0 0 0 9 9" />
                  </svg>
                  Merge to main
                </Menu.Item>
              )}
              {onDelete && (
                <Menu.Item
                  danger
                  disabled={deleteDisabled}
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Delete
                </Menu.Item>
              )}
            </Menu.Content>
          </Menu.Root>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(true);
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted opacity-40 transition-all hover:!opacity-70 hover:!text-text"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </button>
        ))}
    </div>
  );
}
