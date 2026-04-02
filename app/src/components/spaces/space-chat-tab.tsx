import { useEffect, useRef, useState } from "react";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Menu } from "@/components/ui/menu";
import { StatusDot } from "@/components/ui/status-dot";
import { instanceStatusVariant } from "@/lib/utils";
import type { InstanceInfo } from "@shared/types";

export function SpaceChatTab({
  instance,
  isActive,
  onClick,
  onRename,
  onDelete,
}: {
  instance: InstanceInfo;
  isActive: boolean;
  onClick: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

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
      onRename(trimmed);
    }
    setEditing(false);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") setEditing(false);
  };

  return (
    <div
      data-chat-tab-id={instance.id}
      role="tab"
      tabIndex={0}
      onClick={() => {
        if (!editing) onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !editing) onClick();
      }}
      className={`group/tab relative flex shrink-0 cursor-pointer items-center gap-1 border-r border-border px-2.5 py-1.5 text-[0.75rem] transition-colors ${
        isActive
          ? "bg-background text-text-bright shadow-[inset_0_-2px_0_0_var(--color-accent)]"
          : "text-muted hover:bg-surface-hover hover:text-text"
      }`}
    >
      <StatusDot variant={instanceStatusVariant(instance.status)} />
      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleEditKeyDown}
          className="w-[120px] rounded bg-bg px-1 py-0.5 text-[0.8125rem] font-medium text-text-bright outline-none ring-1 ring-accent"
        />
      ) : (
        <span className="max-w-[200px] truncate font-medium">{instance.name}</span>
      )}
      <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Menu.Trigger
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
          }}
          className={`ml-0.5 flex h-4 w-4 items-center justify-center rounded transition-opacity hover:bg-surface-hover ${
            editing
              ? "hidden"
              : "opacity-0 group-hover/tab:opacity-100 data-[popup-open]:opacity-100"
          }`}
        >
          <MoreVertical size={11} />
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
            danger
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 size={13} strokeWidth={2} />
            Remove
          </Menu.Item>
        </Menu.Content>
      </Menu.Root>
    </div>
  );
}
