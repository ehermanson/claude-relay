/**
 * SidebarSpaceGroup — A space entry in the project sidebar.
 *
 * Shows the space name + branch badge, and a context menu for
 * Complete (merge), Delete, and View Diff actions.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { GitBranch, GitMerge, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Menu } from "../ui/menu";
import type { SpaceInfo } from "@shared/types";

interface SidebarSpaceGroupProps {
  space: SpaceInfo;
  projectId: string;
  isActive: boolean;
  onRename: (spaceId: string, name: string) => void;
  onComplete: (spaceId: string) => void;
  onDelete: (spaceId: string) => void;
}

export function SidebarSpaceGroup({
  space,
  projectId,
  isActive,
  onRename,
  onComplete,
  onDelete,
}: SidebarSpaceGroupProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const hasMenu = !space.isDefault;

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEditing = () => {
    setEditValue(space.name);
    setEditing(true);
  };

  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== space.name) {
      onRename(space.id, trimmed);
    }
    setEditing(false);
  };

  return (
    <Link
      to="/projects/$projectId/spaces/$spaceId"
      params={{ projectId, spaceId: space.id }}
      onClick={(e: React.MouseEvent) => {
        if (editing) e.preventDefault();
      }}
      className={`group relative flex cursor-pointer items-start gap-2 rounded-lg px-3 py-1.5 transition-all duration-150 ${
        isActive ? "bg-accent-dim text-accent" : "text-text hover:bg-surface-hover"
      }`}
    >
      {/* Branch icon */}
      <span className="absolute left-2.5 top-2 flex h-3 w-3 items-center justify-center">
        <GitBranch
          size={10}
          strokeWidth={2.5}
          className={isActive ? "text-accent" : "text-muted"}
        />
      </span>

      {/* Name + branch */}
      <div className="min-w-0 flex-1 pl-5">
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-full rounded border border-border bg-surface px-1 py-0.5 text-[0.8125rem] font-medium leading-tight text-text-bright outline-none focus:border-accent"
          />
        ) : (
          <div
            className={`min-w-0 truncate text-[0.8125rem] leading-tight ${isActive ? "font-semibold text-accent" : "font-medium text-text"}`}
          >
            {space.name}
          </div>
        )}
        {!editing && space.gitBranch && (
          <div className="mt-0.5 flex items-center gap-1 truncate text-[0.6875rem] leading-tight text-muted">
            <span className="truncate">{space.gitBranch}</span>
          </div>
        )}
      </div>

      {/* Context menu */}
      {hasMenu && (
        <span className="relative ml-auto flex w-12 shrink-0 items-center justify-end self-start">
          {menuOpen ? (
            <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
              <Menu.Trigger
                onClick={(e: React.MouseEvent) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                className="absolute inset-0 flex items-start justify-end rounded pt-px text-muted hover:!text-text"
              >
                <MoreVertical size={12} />
              </Menu.Trigger>
              <Menu.Content>
                <Menu.Item
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    startEditing();
                  }}
                >
                  <Pencil size={13} strokeWidth={2} className="text-muted" />
                  Rename
                </Menu.Item>
                <Menu.Item
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    onComplete(space.id);
                  }}
                >
                  <GitMerge size={13} strokeWidth={2} className="text-muted" />
                  Complete & merge
                </Menu.Item>
                <Menu.Separator />
                <Menu.Item
                  danger
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    onDelete(space.id);
                  }}
                >
                  <Trash2 size={13} strokeWidth={2} />
                  Delete
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>
          ) : (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setMenuOpen(true);
              }}
              className="absolute inset-0 flex items-start justify-end rounded pt-px text-muted/60 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:!text-text"
            >
              <MoreVertical size={12} />
            </button>
          )}
        </span>
      )}
    </Link>
  );
}
