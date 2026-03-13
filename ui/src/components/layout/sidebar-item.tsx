import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  GitBranch,
  GitMerge,
  MoreVertical,
  Pencil,
  RotateCw,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { Menu } from "../ui/menu";
import { Tooltip } from "../ui/tooltip";
import { ProviderLogo } from "../chat/input-area/shared";
import { formatTimeAgo } from "../../lib/utils";
import type { InstanceInfo } from "@shared/types";

interface SidebarItemProps {
  instance: InstanceInfo;
  isActive: boolean;
  isChild?: boolean;
  parentInstance?: { id: string; name: string };
  to: string;
  params: Record<string, string>;
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
  to,
  params,
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

  // Build status tooltip
  let statusTip: string;
  if (instance.external) {
    statusTip =
      instance.status === "stopped"
        ? "External session (ended)"
        : instance.status === "processing"
          ? "External session (active)"
          : "External session";
  } else if (hasPendingTool) {
    statusTip = "Waiting for permission";
  } else if (instance.status === "processing") {
    statusTip = "Processing";
  } else if (instance.status === "idle") {
    statusTip = "Idle";
  } else if (instance.status === "error") {
    statusTip = "Error";
  } else {
    statusTip = "Ended";
  }

  return (
    <Link
      to={to}
      params={params}
      onClick={(e: React.MouseEvent) => {
        if (editing) e.preventDefault();
      }}
      className={`group relative flex cursor-pointer items-start rounded-lg px-3 py-2 transition-colors ${
        isChild ? "pl-7" : ""
      } ${isActive ? "bg-accent-dim text-accent" : "text-text hover:bg-surface-hover"}`}
    >
      {/* Status indicator — absolutely positioned in the left padding */}
      <span className="absolute left-2.5 top-2.5 flex h-3 w-3 items-center justify-center">
        {instance.external ? (
          instance.status === "idle" || instance.status === "processing" ? (
            <Tooltip content={statusTip} side="right">
              <SquareTerminal size={12} strokeWidth={2} className="text-muted" />
            </Tooltip>
          ) : null
        ) : instance.status !== "stopped" ? (
          <Tooltip content={statusTip} side="right">
            <span
              className={`h-[6px] w-[6px] rounded-full ${
                hasPendingTool
                  ? "animate-pulse-dot bg-warning"
                  : instance.status === "processing"
                    ? "animate-pulse-dot bg-warning"
                    : instance.status === "error"
                      ? "bg-error"
                      : "bg-text/30"
              }`}
            />
          </Tooltip>
        ) : null}
      </span>

      {/* Name + preview */}
      <div className="min-w-0 flex-1 pl-5">
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
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium leading-tight text-text-bright">
              {instance.name}
            </div>
            <ProviderLogo
              provider={instance.provider}
              className="mt-0.5 h-3 w-3 shrink-0 text-muted/55 opacity-0 transition-opacity group-hover:opacity-100"
              muted
            />
          </div>
        )}
        {!editing && instance.gitBranch && (
          <div className="mt-0.5 flex items-center gap-1 truncate text-[0.6875rem] leading-tight text-muted">
            <GitBranch size={10} strokeWidth={2.5} className="shrink-0" />
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
              onClick={(e: React.MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted opacity-100 transition-all hover:!text-text"
            >
              <MoreVertical size={12} />
            </Menu.Trigger>
            <Menu.Content>
              {onRename && (
                <Menu.Item
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    startEditing();
                  }}
                >
                  <Pencil size={13} strokeWidth={2} className="text-muted" />
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
                  <RotateCw size={13} strokeWidth={2} className="text-muted" />
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
                  <GitMerge size={13} strokeWidth={2} className="text-muted" />
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
                  <Trash2 size={13} strokeWidth={2} />
                  Delete
                </Menu.Item>
              )}
            </Menu.Content>
          </Menu.Root>
        ) : (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenuOpen(true);
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted opacity-0 transition-all group-hover:opacity-60 hover:!opacity-100 hover:!text-text"
          >
            <MoreVertical size={12} />
          </button>
        ))}
    </Link>
  );
}
