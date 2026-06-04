import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, GitBranch } from "lucide-react";
import {
  createSpace,
  fetchConvertibleWorktrees,
  convertWorktreeToSpace,
  type ConvertibleWorktree,
} from "../../lib/api";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";

type DialogMode = "create" | "convert";

interface OpenOptions {
  mode?: DialogMode;
  worktreePath?: string;
}

interface OpenState {
  dir: string;
  mode: DialogMode;
  worktreePath?: string;
}

export function useCreateSpaceDialog() {
  const [state, setState] = useState<OpenState | null>(null);

  return {
    isOpen: !!state,
    dir: state?.dir ?? null,
    mode: state?.mode ?? "create",
    preselectedWorktreePath: state?.worktreePath,
    open: (directory: string, opts?: OpenOptions) =>
      setState({
        dir: directory,
        mode: opts?.mode ?? "create",
        worktreePath: opts?.worktreePath,
      }),
    close: () => setState(null),
  };
}

export function CreateSpaceDialog({
  dir,
  mode = "create",
  preselectedWorktreePath,
  projectName: _projectName,
  projectId,
  defaultBaseBranch,
  spaceBranchSource,
  onOpenChange,
}: {
  dir: string | null;
  mode?: DialogMode;
  preselectedWorktreePath?: string;
  projectName: string;
  projectId: string | undefined;
  defaultBaseBranch?: string;
  spaceBranchSource?: "local" | "remote";
  onOpenChange: (open: boolean) => void;
}) {
  const [activeMode, setActiveMode] = useState<DialogMode>(mode);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [baseBranch, setBaseBranch] = useState("");
  const [selectedWorktreePath, setSelectedWorktreePath] = useState<string | undefined>(
    preselectedWorktreePath,
  );
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleClose = () => {
    setName("");
    setDescription("");
    setBaseBranch("");
    setSelectedWorktreePath(undefined);
    onOpenChange(false);
  };

  // Sync mode + preselection when the dialog reopens with new options
  useEffect(() => {
    if (dir) {
      setActiveMode(mode);
      setSelectedWorktreePath(preselectedWorktreePath);
    }
  }, [dir, mode, preselectedWorktreePath]);

  const { data: convertibleWorktrees = [], isLoading: worktreesLoading } = useQuery({
    queryKey: ["convertible-worktrees", projectId],
    queryFn: () => fetchConvertibleWorktrees(projectId ?? ""),
    enabled: !!projectId && !!dir && activeMode === "convert",
    staleTime: 5000,
  });

  const selectedWorktree: ConvertibleWorktree | undefined = useMemo(
    () => convertibleWorktrees.find((w) => w.path === selectedWorktreePath),
    [convertibleWorktrees, selectedWorktreePath],
  );

  const displayBranch = defaultBaseBranch
    ? spaceBranchSource === "remote"
      ? `origin/${defaultBaseBranch}`
      : defaultBaseBranch
    : undefined;

  const handleCreate = async () => {
    if (!projectId) {
      toast.error("Project not found");
      return;
    }
    try {
      const effectiveBranch = baseBranch.trim() || defaultBaseBranch || undefined;
      const space = await createSpace(projectId, {
        name: name.trim() || undefined,
        baseBranch: effectiveBranch,
        description: description.trim() || undefined,
      });
      handleClose();
      await queryClient.invalidateQueries({ queryKey: ["spaces", projectId] });
      navigate({
        to: "/projects/$projectId/spaces/$spaceId",
        params: { projectId, spaceId: space.id },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create space");
    }
  };

  const handleConvert = async () => {
    if (!projectId) {
      toast.error("Project not found");
      return;
    }
    if (!selectedWorktreePath) {
      toast.error("Pick a worktree to convert");
      return;
    }
    try {
      const space = await convertWorktreeToSpace(projectId, {
        worktreePath: selectedWorktreePath,
        name: name.trim() || undefined,
        description: description.trim() || undefined,
      });
      handleClose();
      await queryClient.invalidateQueries({ queryKey: ["spaces", projectId] });
      await queryClient.invalidateQueries({ queryKey: ["branches", projectId] });
      await queryClient.invalidateQueries({
        queryKey: ["convertible-worktrees", projectId],
      });
      navigate({
        to: "/projects/$projectId/spaces/$spaceId",
        params: { projectId, spaceId: space.id },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to convert worktree");
    }
  };

  const submit = activeMode === "convert" ? handleConvert : handleCreate;
  const submitDisabled = activeMode === "convert" && !selectedWorktreePath;

  return (
    <Dialog.Root
      open={!!dir}
      onOpenChange={(open) => {
        if (!open) handleClose();
        onOpenChange(true);
      }}
    >
      <Dialog.Content maxWidth="max-w-md">
        <Dialog.Header>
          <Dialog.Title>
            {activeMode === "convert" ? "Convert Worktree to Space" : "Create Space"}
          </Dialog.Title>
          <Dialog.Close />
        </Dialog.Header>
        <div className="space-y-3">
          {/* Mode toggle */}
          <div className="flex rounded-md border border-border p-0.5 text-[0.75rem]">
            <button
              type="button"
              onClick={() => setActiveMode("create")}
              className={`flex-1 rounded px-2 py-1 transition-colors ${
                activeMode === "create"
                  ? "bg-surface-hover text-text"
                  : "text-muted hover:text-text"
              }`}
            >
              Create new
            </button>
            <button
              type="button"
              onClick={() => setActiveMode("convert")}
              className={`flex-1 rounded px-2 py-1 transition-colors ${
                activeMode === "convert"
                  ? "bg-surface-hover text-text"
                  : "text-muted hover:text-text"
              }`}
            >
              Convert existing
            </button>
          </div>

          {activeMode === "create" ? (
            <p className="text-[0.8125rem] text-muted">
              A space is an isolated workspace for focused work. Changes here won&apos;t affect your
              main workspace until you complete the space.
            </p>
          ) : (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-[0.75rem] text-text">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
              <div className="space-y-1">
                <p>
                  Relay will take over this worktree&apos;s git lifecycle.{" "}
                  <span className="font-medium">Complete</span> merges its branch into your main
                  workspace and removes the worktree. <span className="font-medium">Archive</span>{" "}
                  deletes the worktree and its branch.
                </p>
                <p className="text-muted">
                  A git-excluded <code className="text-text/80">.relay/space-context.md</code>{" "}
                  coordination file will be added inside the worktree.
                </p>
              </div>
            </div>
          )}

          {/* Convert mode: worktree picker */}
          {activeMode === "convert" && (
            <div className="space-y-1.5">
              <label className="text-[0.75rem] font-medium text-muted">Worktree</label>
              {worktreesLoading ? (
                <div className="rounded-md border border-border p-3 text-[0.75rem] text-muted">
                  Loading worktrees…
                </div>
              ) : convertibleWorktrees.length === 0 ? (
                <div className="rounded-md border border-border p-3 text-[0.75rem] text-muted">
                  No unconverted worktrees were found for this project.
                </div>
              ) : (
                <div className="max-h-48 overflow-y-auto rounded-md border border-border">
                  {convertibleWorktrees.map((w) => {
                    const selected = w.path === selectedWorktreePath;
                    return (
                      <button
                        key={w.path}
                        type="button"
                        onClick={() => setSelectedWorktreePath(w.path)}
                        className={`flex w-full flex-col items-start gap-0.5 border-b border-border px-3 py-2 text-left text-[0.75rem] transition-colors last:border-b-0 ${
                          selected
                            ? "bg-surface-hover text-text"
                            : "text-muted hover:bg-surface-hover hover:text-text"
                        }`}
                      >
                        <span className="flex items-center gap-1.5 font-medium text-text">
                          <GitBranch size={12} className="shrink-0" />
                          {w.branch}
                        </span>
                        <span className="truncate font-mono text-[0.6875rem] text-muted">
                          {w.path}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-[0.75rem] font-medium text-muted" htmlFor="create-space-name">
              Name
            </label>
            <Input
              id="create-space-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void submit();
                }
              }}
              placeholder={
                activeMode === "convert"
                  ? selectedWorktree?.branch || "Defaults to branch name"
                  : "Optional"
              }
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label
              className="text-[0.75rem] font-medium text-muted"
              htmlFor="create-space-description"
            >
              Description
            </label>
            <textarea
              id="create-space-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this space for? (optional)"
              rows={3}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-text placeholder:text-muted/50 focus:border-accent focus:outline-none"
            />
          </div>

          {/* Base branch — only in create mode */}
          {activeMode === "create" && (
            <div className="space-y-1.5">
              <label
                className="text-[0.75rem] font-medium text-muted"
                htmlFor="create-space-branch"
              >
                Base Branch
              </label>
              <Input
                id="create-space-branch"
                value={baseBranch}
                onChange={(event) => setBaseBranch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void submit();
                  }
                }}
                placeholder={displayBranch || "Current branch"}
              />
              {displayBranch && !baseBranch.trim() && (
                <p className="text-[0.6875rem] text-muted">
                  Defaults to <span className="font-medium text-text">{displayBranch}</span> from
                  project settings
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={submitDisabled}
              onClick={() => void submit()}
            >
              {activeMode === "convert" ? "Convert Worktree" : "Create Space"}
            </Button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
