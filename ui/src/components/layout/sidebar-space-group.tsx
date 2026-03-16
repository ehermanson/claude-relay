/**
 * SidebarSpaceGroup — A space entry in the project sidebar.
 *
 * Shows the space name + branch badge, and a context menu for
 * Complete (merge), Delete, and View Diff actions.
 */

import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { GitBranch, GitMerge, MoreVertical, Trash2, FileCode2 } from "lucide-react";
import { Menu } from "../ui/menu";
import type { SpaceInfo } from "@shared/types";

interface SidebarSpaceGroupProps {
  space: SpaceInfo;
  projectId: string;
  isActive: boolean;
  onComplete: (spaceId: string) => void;
  onDelete: (spaceId: string) => void;
}

export function SidebarSpaceGroup({
  space,
  projectId,
  isActive,
  onComplete,
  onDelete,
}: SidebarSpaceGroupProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const hasMenu = !space.isDefault;

  return (
    <Link
      to="/projects/$projectId/spaces/$spaceId"
      params={{ projectId, spaceId: space.id }}
      className={`group relative flex cursor-pointer items-start gap-2 rounded-lg px-3 py-1.5 transition-colors ${
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
        <div
          className={`min-w-0 truncate text-[0.8125rem] leading-tight ${isActive ? "font-semibold text-accent" : "font-medium text-text"}`}
        >
          {space.name}
        </div>
        {space.gitBranch && (
          <div className="mt-0.5 flex items-center gap-1 truncate text-[0.6875rem] leading-tight text-muted">
            <span className="truncate">{space.gitBranch}</span>
          </div>
        )}
        <div className="mt-0.5 text-[0.625rem] text-muted/50">
          {space.chatCount} chat{space.chatCount !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Context menu */}
      {hasMenu && (
        <span className="relative ml-auto flex w-8 shrink-0 items-center justify-end self-start">
          {menuOpen ? (
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
                <Menu.Item
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    navigate({
                      to: "/projects/$projectId/spaces/$spaceId/diff",
                      params: { projectId, spaceId: space.id },
                    });
                  }}
                >
                  <FileCode2 size={13} strokeWidth={2} className="text-muted" />
                  View diff
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
              className="absolute inset-0 flex items-center justify-end rounded text-muted/60 opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:!text-text"
            >
              <MoreVertical size={12} />
            </button>
          )}
        </span>
      )}
    </Link>
  );
}
