import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Columns2, GitBranch, GitMerge, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Menu } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { getInstanceProjectRouteId } from "@/lib/project-route";
import { formatTimeAgo } from "@/lib/utils";
import type { InstanceInfo } from "@shared/types";

interface SidebarItemProps {
  instance: InstanceInfo;
  isActive: boolean;
  isChild?: boolean;
  parentInstance?: { id: string; name: string };
  to: string;
  params: Record<string, string>;
  onDelete?: (instance: Pick<InstanceInfo, "id" | "name">) => void;
  deleteDisabled?: boolean;
  onRename?: (name: string) => void;
  onMerge?: () => void;
  /** Currently active chatId — used to offer "Open in split view". */
  activeChatId?: string;
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
  onRename,
  onMerge,
  activeChatId,
}: SidebarItemProps) {
  const navigate = useNavigate({ from: "/projects/$projectId/chats/$chatId" });
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const canSplit = !!activeChatId && activeChatId !== instance.id;
  const hasMenu = !!onDelete || !!onRename || !!onMerge || canSplit;

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
  const isStopped = instance.status === "stopped";

  // Status dot color + tooltip — matches instance-header.tsx logic
  let dotClass: string;
  let statusTip: string;
  if (isStopped) {
    dotClass = "bg-muted";
    statusTip = instance.external ? "External chat (ended)" : "Ended";
  } else if (hasPendingTool) {
    dotClass = "animate-pulse-dot bg-warning";
    statusTip = "Waiting for permission";
  } else if (instance.status === "processing") {
    dotClass = "animate-pulse-dot bg-warning";
    statusTip = instance.external ? "External chat (active)" : "Processing";
  } else if (instance.status === "error") {
    dotClass = "bg-error";
    statusTip = "Error";
  } else if (instance.external) {
    dotClass = "bg-accent";
    statusTip = "External chat";
  } else {
    dotClass = "bg-accent";
    statusTip = "Idle";
  }

  return (
    <Link
      to={to}
      params={params}
      onClick={(e: React.MouseEvent) => {
        if (editing) e.preventDefault();
      }}
      className={`group relative flex cursor-pointer items-start gap-2 rounded-lg px-3 py-1.5 transition-all duration-150 ${
        isChild ? "pl-7" : ""
      } ${isActive ? "bg-accent-dim text-accent" : "text-text hover:bg-surface-hover"}`}
    >
      {/* Status indicator — absolutely positioned in the left padding */}
      <span className="absolute left-2.5 top-2 flex h-3 w-3 items-center justify-center">
        <Tooltip content={statusTip} side="right">
          <span className={`h-[6px] w-[6px] rounded-full ${dotClass}`} />
        </Tooltip>
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
          <div
            className={`min-w-0 truncate text-[0.8125rem] leading-tight ${isActive ? "font-semibold text-accent" : "font-medium text-text"}`}
          >
            {instance.name}
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
                navigate({
                  to: "/projects/$projectId/chats/$chatId",
                  params: {
                    projectId: getInstanceProjectRouteId(instance),
                    chatId: parentInstance.id,
                  },
                });
              }}
              className="mt-0.5 max-w-full truncate text-[0.6875rem] leading-tight text-muted transition-colors hover:text-accent"
            >
              <span className="mr-0.5">{"\u21B3"}</span> from {parentInstance.name}
            </button>
          </Tooltip>
        )}
      </div>

      {/* Right slot: timestamp (default) ↔ menu trigger (hover) */}
      {!editing && (
        <span className="relative ml-auto flex w-12 shrink-0 items-center justify-end self-start">
          {/* Timestamp — fades out on hover */}
          {instance.lastActivityAt > 0 && (
            <span
              className={`pt-px text-[0.625rem] text-muted/50 transition-opacity duration-150${hasMenu ? " group-hover:opacity-0" : ""}`}
            >
              {formatTimeAgo(instance.lastActivityAt)}
            </span>
          )}

          {/* Menu trigger — fades in on hover */}
          {hasMenu &&
            (menuOpen ? (
              <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
                <Menu.Trigger
                  onClick={(e: React.MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  className="absolute inset-0 flex items-center justify-end rounded text-muted hover:!text-text"
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
                  {canSplit && (
                    <Menu.Item
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        navigate({
                          search: { split: instance.id },
                        });
                      }}
                    >
                      <Columns2 size={13} strokeWidth={2} className="text-muted" />
                      Open in split view
                    </Menu.Item>
                  )}
                  {onDelete && (
                    <Menu.Item
                      danger
                      disabled={deleteDisabled}
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        onDelete({ id: instance.id, name: instance.name });
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
                className="absolute inset-0 flex items-center justify-end rounded text-muted/60 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:!text-text"
              >
                <MoreVertical size={12} />
              </button>
            ))}
        </span>
      )}
    </Link>
  );
}
