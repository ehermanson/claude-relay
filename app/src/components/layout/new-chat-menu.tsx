/**
 * "New" trigger shared by the inbox header and the collapsed rail.
 *
 * Chat-only by default: with exactly one possible target project the trigger
 * creates the chat directly, otherwise it opens a project picker. Callers
 * resolve their own sole target (the header honors the active project filter)
 * and supply their own trigger styling, since the two surfaces size and place
 * it differently.
 *
 * When `onCreateSpace` is supplied the trigger becomes a combined "New" menu
 * offering both New chat and New space — spaces have no other home in the flat
 * inbox layout, so the header/rail surface them here rather than only in the
 * collapsed "Projects" section. Space creation is offered only for
 * `spaceCapable` targets (a session-only group can't resolve a projectId for
 * the create-space dialog); when none apply the trigger falls back to the
 * chat-only behavior. The branching lives in `resolveNewMenuShape` so it's unit
 * testable without mounting a menu.
 */

import { useState } from "react";
import { ChevronRight, GitBranch, MessageSquarePlus } from "lucide-react";
import { Menu } from "@/components/ui/menu";
import { ProjectAvatar } from "@/components/ui/project-avatar";
import { Tooltip } from "@/components/ui/tooltip";
import { resolveNewMenuShape, type InboxProjectOption } from "@/lib/inbox";

function ProjectPickerItems({
  projectOptions,
  onSelect,
}: {
  projectOptions: InboxProjectOption[];
  onSelect: (dir: string) => void;
}) {
  return (
    <>
      {projectOptions.map((option) => (
        <Menu.Item key={option.dir} onClick={() => onSelect(option.dir)}>
          <ProjectAvatar iconPath={option.iconPath} name={option.name} />
          <span className="min-w-0 truncate">{option.name}</span>
        </Menu.Item>
      ))}
    </>
  );
}

function ChatMenuItem({ dir, onCreate }: { dir: string; onCreate: (dir: string) => void }) {
  return (
    <Menu.Item className="!items-start" onClick={() => onCreate(dir)}>
      <MessageSquarePlus size={13} strokeWidth={2} className="mt-1 text-muted" />
      <div>
        <div>New Chat</div>
        <div className="text-[0.6875rem] text-muted">Work with an agent on this branch</div>
      </div>
    </Menu.Item>
  );
}

function SpaceMenuItem({ dir, onCreate }: { dir: string; onCreate: (dir: string) => void }) {
  return (
    <Menu.Item className="!items-start" onClick={() => onCreate(dir)}>
      <GitBranch size={13} strokeWidth={2} className="mt-1 text-muted" />
      <div>
        <div>New Space</div>
        <div className="text-[0.6875rem] text-muted">
          Start an isolated worktree and merge back later
        </div>
      </div>
    </Menu.Item>
  );
}

export function NewChatMenu({
  projectOptions,
  soleTarget,
  onCreate,
  onCreateSpace,
  icon,
  tooltipSide,
  align,
  triggerClassName,
}: {
  projectOptions: InboxProjectOption[];
  /** When set, the trigger creates directly in this project instead of asking. */
  soleTarget: string | null;
  onCreate: (dir: string) => void;
  /** When set, the menu also offers "New space" for space-capable targets. */
  onCreateSpace?: (dir: string) => void;
  icon: React.ReactNode;
  tooltipSide: "bottom" | "right";
  align: "start" | "end";
  triggerClassName: string;
}) {
  const [open, setOpen] = useState(false);
  const shape = resolveNewMenuShape(projectOptions, soleTarget, !!onCreateSpace);
  const combined = shape.kind === "combined-direct" || shape.kind === "combined-picker";
  const label = combined ? "New" : "New chat";

  // A lone target with no space action is a plain button, not a menu.
  if (shape.kind === "chat-direct") {
    return (
      <Tooltip content={label} side={tooltipSide}>
        <button
          type="button"
          aria-label={label}
          onClick={() => onCreate(shape.dir)}
          className={triggerClassName}
        >
          {icon}
        </button>
      </Tooltip>
    );
  }

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Tooltip content={label} side={tooltipSide}>
        <Menu.Trigger aria-label={label} className={triggerClassName}>
          {icon}
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content align={align}>
        {shape.kind === "chat-picker" && (
          <ProjectPickerItems projectOptions={shape.chatProjects} onSelect={onCreate} />
        )}
        {shape.kind === "combined-direct" && (
          <>
            <ChatMenuItem dir={shape.dir} onCreate={onCreate} />
            <SpaceMenuItem dir={shape.dir} onCreate={onCreateSpace!} />
          </>
        )}
        {shape.kind === "combined-picker" && (
          <>
            <Menu.Sub>
              <Menu.SubTrigger>
                <MessageSquarePlus size={13} strokeWidth={2} className="text-muted" />
                <span className="flex-1">New Chat</span>
                <ChevronRight size={12} className="text-muted" />
              </Menu.SubTrigger>
              <Menu.SubContent>
                <ProjectPickerItems projectOptions={shape.chatProjects} onSelect={onCreate} />
              </Menu.SubContent>
            </Menu.Sub>
            <Menu.Sub>
              <Menu.SubTrigger>
                <GitBranch size={13} strokeWidth={2} className="text-muted" />
                <span className="flex-1">New Space</span>
                <ChevronRight size={12} className="text-muted" />
              </Menu.SubTrigger>
              <Menu.SubContent>
                <ProjectPickerItems
                  projectOptions={shape.spaceProjects}
                  onSelect={onCreateSpace!}
                />
              </Menu.SubContent>
            </Menu.Sub>
          </>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}
