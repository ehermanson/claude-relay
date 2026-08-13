/**
 * The per-project context menu shared by both sidebar layouts: the project
 * group header in Projects mode, and the Projects section in Inbox mode.
 *
 * Only the menu *contents* live here — each caller supplies its own trigger,
 * since the two layouts position and reveal it differently.
 */

import { useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Bug,
  FolderMinus,
  NotebookPen,
  Settings,
  Toolbox,
} from "lucide-react";
import { Menu } from "@/components/ui/menu";
import { useSidebarActions } from "@/context/sidebar-actions-context";
import type { RemoveProjectTarget } from "@/lib/project-route";

export interface ProjectReorderActions {
  isFirst?: boolean;
  isLast?: boolean;
  onMoveToTop?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onMoveToBottom?: () => void;
}

export function ProjectActionsMenuContent({
  routeProjectId,
  removeProjectTarget,
  reorder,
}: {
  routeProjectId: string;
  removeProjectTarget: RemoveProjectTarget;
  reorder?: ProjectReorderActions;
}) {
  const navigate = useNavigate();
  const actions = useSidebarActions();
  const { isFirst, isLast, onMoveToTop, onMoveUp, onMoveDown, onMoveToBottom } = reorder ?? {};

  const go = (to: string) => (event: React.MouseEvent) => {
    event.stopPropagation();
    navigate({ to, params: { projectId: routeProjectId } });
  };

  return (
    <Menu.Content>
      <Menu.Item onClick={go("/projects/$projectId/plans")}>
        <NotebookPen size={13} strokeWidth={2} className="text-muted" />
        Plans
      </Menu.Item>
      <Menu.Item onClick={go("/projects/$projectId/tasks")}>
        <Bug size={13} strokeWidth={2} className="text-muted" />
        Tasks
      </Menu.Item>
      <Menu.Item onClick={go("/projects/$projectId/skills")}>
        <Toolbox size={13} strokeWidth={2} className="text-muted" />
        Skills
      </Menu.Item>
      <Menu.Item onClick={go("/projects/$projectId/settings")}>
        <Settings size={13} strokeWidth={2} className="text-muted" />
        Settings
      </Menu.Item>
      {(onMoveToTop || onMoveUp || onMoveDown || onMoveToBottom) && <Menu.Separator />}
      {onMoveToTop && (
        <Menu.Item
          disabled={isFirst}
          onClick={(event: React.MouseEvent) => {
            event.stopPropagation();
            onMoveToTop();
          }}
        >
          <ArrowUpToLine size={13} strokeWidth={2} className="text-muted" />
          Move to top
        </Menu.Item>
      )}
      {onMoveUp && (
        <Menu.Item
          disabled={isFirst}
          onClick={(event: React.MouseEvent) => {
            event.stopPropagation();
            onMoveUp();
          }}
        >
          <ArrowUp size={13} strokeWidth={2} className="text-muted" />
          Move up
        </Menu.Item>
      )}
      {onMoveDown && (
        <Menu.Item
          disabled={isLast}
          onClick={(event: React.MouseEvent) => {
            event.stopPropagation();
            onMoveDown();
          }}
        >
          <ArrowDown size={13} strokeWidth={2} className="text-muted" />
          Move down
        </Menu.Item>
      )}
      {onMoveToBottom && (
        <Menu.Item
          disabled={isLast}
          onClick={(event: React.MouseEvent) => {
            event.stopPropagation();
            onMoveToBottom();
          }}
        >
          <ArrowDownToLine size={13} strokeWidth={2} className="text-muted" />
          Move to bottom
        </Menu.Item>
      )}
      <Menu.Separator />
      <Menu.Item
        onClick={() => {
          actions.removeProject(removeProjectTarget);
        }}
      >
        <FolderMinus size={13} strokeWidth={2} className="text-muted" />
        Remove project
      </Menu.Item>
    </Menu.Content>
  );
}
