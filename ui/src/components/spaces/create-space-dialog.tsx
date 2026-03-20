import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createSpace } from "../../lib/api";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";

export function useCreateSpaceDialog() {
  const [dir, setDir] = useState<string | null>(null);

  return {
    isOpen: !!dir,
    dir,
    open: (directory: string) => setDir(directory),
    close: () => setDir(null),
  };
}

export function CreateSpaceDialog({
  dir,
  projectName,
  projectId,
  onOpenChange,
}: {
  dir: string | null;
  projectName: string;
  projectId: string | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleCreate = async () => {
    if (!projectId) {
      toast.error("Project not found");
      return;
    }
    try {
      const space = await createSpace(projectId, {
        name: name.trim() || undefined,
      });
      onOpenChange(false);
      await queryClient.invalidateQueries({ queryKey: ["spaces", projectId] });
      navigate({
        to: "/projects/$projectId/spaces/$spaceId",
        params: { projectId, spaceId: space.id },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create space");
    }
  };

  return (
    <Dialog.Root
      open={!!dir}
      onOpenChange={(open) => {
        if (!open) setName("");
        onOpenChange(open);
      }}
    >
      <Dialog.Content maxWidth="max-w-md">
        <Dialog.Header>
          <Dialog.Title>Create Space</Dialog.Title>
          <Dialog.Close />
        </Dialog.Header>
        <div className="space-y-3">
          <p className="text-[0.8125rem] text-muted">
            Create an isolated branch and working copy of{" "}
            <span className="font-medium text-text">{projectName}</span>. Changes in a space
            won&apos;t affect your main project directory — to run a dev server against the space,
            you&apos;ll need to open a terminal at its path.
          </p>
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
                  void handleCreate();
                }
              }}
              placeholder="Optional"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void handleCreate()}>
              Create Space
            </Button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
