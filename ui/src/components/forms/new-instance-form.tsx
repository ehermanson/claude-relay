import { useState } from "react";
import { DirectoryPicker } from "./directory-picker";
import { Button } from "../ui/button";

interface NewInstanceFormProps {
  onSubmit: (options: { workingDirectory?: string }) => void;
  onCancel: () => void;
}

export function NewInstanceForm({ onSubmit, onCancel }: NewInstanceFormProps) {
  const [cwd, setCwd] = useState("");

  const handleCreate = () => {
    const payload: { workingDirectory?: string } = {};
    if (cwd.trim()) payload.workingDirectory = cwd.trim();
    onSubmit(payload);
    setCwd("");
  };

  return (
    <>
      <div className="mb-3 flex flex-col gap-1.5">
        <label className="text-[0.6875rem] font-medium text-muted">Working Directory</label>
        <DirectoryPicker value={cwd} onChange={setCwd} />
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            onCancel();
            setCwd("");
          }}
        >
          Cancel
        </Button>
        <Button variant="primary" onClick={handleCreate}>
          Create
        </Button>
      </div>
    </>
  );
}
