/**
 * "New chat" trigger shared by the inbox header and the collapsed rail.
 *
 * With exactly one possible target project the trigger creates the chat
 * directly; otherwise it opens a project picker. Callers resolve their own
 * sole target (the header honors the active project filter) and supply their
 * own trigger styling, since the two surfaces size and place it differently.
 */

import { useState } from "react";
import { Menu } from "@/components/ui/menu";
import { ProjectAvatar } from "@/components/ui/project-avatar";
import { Tooltip } from "@/components/ui/tooltip";
import type { InboxProjectOption } from "@/lib/inbox";

export function NewChatMenu({
  projectOptions,
  soleTarget,
  onCreate,
  icon,
  tooltipSide,
  align,
  triggerClassName,
}: {
  projectOptions: InboxProjectOption[];
  /** When set, the trigger creates directly in this project instead of asking. */
  soleTarget: string | null;
  onCreate: (dir: string) => void;
  icon: React.ReactNode;
  tooltipSide: "bottom" | "right";
  align: "start" | "end";
  triggerClassName: string;
}) {
  const [open, setOpen] = useState(false);

  if (soleTarget) {
    return (
      <Tooltip content="New chat" side={tooltipSide}>
        <button
          type="button"
          aria-label="New chat"
          onClick={() => onCreate(soleTarget)}
          className={triggerClassName}
        >
          {icon}
        </button>
      </Tooltip>
    );
  }

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Tooltip content="New chat" side={tooltipSide}>
        <Menu.Trigger aria-label="New chat" className={triggerClassName}>
          {icon}
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content align={align}>
        {projectOptions.map((option) => (
          <Menu.Item key={option.dir} onClick={() => onCreate(option.dir)}>
            <ProjectAvatar iconPath={option.iconPath} name={option.name} />
            <span className="min-w-0 truncate">{option.name}</span>
          </Menu.Item>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
}
