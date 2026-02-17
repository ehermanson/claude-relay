import { useState, useRef, useEffect } from "react";
import { DirectoryPicker } from "./directory-picker";
import { Input } from "../ui/input";
import { CheckboxField } from "../ui/checkbox";
import { Button } from "../ui/button";

interface NewInstanceFormProps {
  onSubmit: (options: {
    name?: string;
    workingDirectory?: string;
    dangerouslySkipPermissions?: boolean;
  }) => void;
  onCancel: () => void;
}

export function NewInstanceForm({ onSubmit, onCancel }: NewInstanceFormProps) {
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [skipPerms, setSkipPerms] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleCreate = () => {
    const payload: {
      name?: string;
      workingDirectory?: string;
      dangerouslySkipPermissions?: boolean;
    } = {};
    if (name.trim()) payload.name = name.trim();
    if (cwd.trim()) payload.workingDirectory = cwd.trim();
    if (skipPerms) payload.dangerouslySkipPermissions = true;
    onSubmit(payload);
    setName("");
    setCwd("");
    setSkipPerms(false);
  };

  return (
    <>
      <div className="mb-3 flex flex-col gap-1.5">
        <label className="text-[0.6875rem] font-medium text-muted">
          Name <span className="font-normal text-muted/60">(optional)</span>
        </label>
        <Input
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. My Project"
        />
      </div>

      <div className="mb-3 flex flex-col gap-1.5">
        <label className="text-[0.6875rem] font-medium text-muted">Working Directory</label>
        <DirectoryPicker
          value={cwd}
          onChange={setCwd}
          onAutoName={(dirName) => {
            if (!name.trim()) setName(dirName);
          }}
        />
      </div>

      <div className="mb-3">
        <CheckboxField
          checked={skipPerms}
          onCheckedChange={setSkipPerms}
          label="Skip permission prompts"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            onCancel();
            setName("");
            setCwd("");
            setSkipPerms(false);
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
