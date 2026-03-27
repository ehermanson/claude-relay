/**
 * Shared Git actions dropdown for chat and space headers.
 * Renders a GitBranch icon trigger with a dropdown of git operations.
 */

import type { ReactNode } from "react";
import {
  ChevronDown,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  FolderOpen,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Menu } from "./menu";
import { Tooltip } from "./tooltip";

interface GitMenuAction {
  label: string;
  icon: ReactNode;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  danger?: boolean;
  /** Shown as a separator before this item */
  separatorBefore?: boolean;
}

interface GitMenuProps {
  /** Called to commit all changes */
  onCommit?: () => void | Promise<void>;
  /** Called to push the branch */
  onPush?: () => void | Promise<void>;
  /** Called to push and create a PR */
  onPushAndCreatePR?: () => void | Promise<void>;
  /** Called to complete/merge (spaces only) */
  onMerge?: () => void | Promise<void>;
  /** Disables the merge action */
  mergeDisabled?: boolean;
  /** Path to copy (worktree directory, spaces only) */
  worktreePath?: string;
  /** Any extra actions to append */
  extraActions?: GitMenuAction[];
}

export function GitMenu({
  onCommit,
  onPush,
  onPushAndCreatePR,
  onMerge,
  mergeDisabled,
  worktreePath,
  extraActions,
}: GitMenuProps) {
  return (
    <Menu.Root>
      <Tooltip content="Git actions">
        <Menu.Trigger className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/50 px-2 text-xs text-muted transition-all duration-150 hover:bg-surface-hover hover:text-text">
          <GitBranch size={13} />
          <ChevronDown size={10} strokeWidth={2.5} />
        </Menu.Trigger>
      </Tooltip>
      <Menu.Content>
        {onMerge && (
          <>
            <Menu.Item onClick={() => void onMerge()} disabled={mergeDisabled}>
              <GitMerge size={13} className="text-muted" />
              Complete
            </Menu.Item>
            <Menu.Separator />
          </>
        )}
        {onCommit && (
          <Menu.Item onClick={() => void onCommit()}>
            <GitCommitHorizontal size={13} className="text-muted" />
            Commit changes
          </Menu.Item>
        )}
        {onPush && (
          <Menu.Item onClick={() => void onPush()}>
            <Upload size={13} className="text-muted" />
            Push branch
          </Menu.Item>
        )}
        {onPushAndCreatePR && (
          <Menu.Item onClick={() => void onPushAndCreatePR()}>
            <GitPullRequest size={13} className="text-muted" />
            Push & create PR
          </Menu.Item>
        )}
        {worktreePath && (
          <>
            <Menu.Separator />
            <Menu.Item
              onClick={() => {
                navigator.clipboard.writeText(worktreePath).then(() => {
                  toast.success("Copied to clipboard");
                });
              }}
            >
              <FolderOpen size={13} className="text-muted" />
              Copy working directory
            </Menu.Item>
          </>
        )}
        {extraActions?.map((action, i) => (
          <span key={i}>
            {action.separatorBefore && <Menu.Separator />}
            <Menu.Item
              onClick={() => void action.onClick()}
              disabled={action.disabled}
              danger={action.danger}
            >
              {action.icon}
              {action.label}
            </Menu.Item>
          </span>
        ))}
      </Menu.Content>
    </Menu.Root>
  );
}
