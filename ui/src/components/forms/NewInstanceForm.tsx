import { useState, useRef, useEffect } from "react";
import { DirectoryPicker } from "./DirectoryPicker";

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
    <div className="shrink-0 border-b border-border px-4 py-3">
      <div className="mb-3 flex flex-col gap-1.5">
        <label className="text-[0.6875rem] font-medium text-muted">
          Name <span className="font-normal text-muted/60">(optional)</span>
        </label>
        <input
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. My Project"
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[0.8125rem] text-text transition-colors placeholder:text-muted focus:border-accent focus:ring-1 focus:ring-accent-dim focus:outline-none"
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

      <div className="mb-3 flex items-center gap-2">
        <input
          type="checkbox"
          id="skip-perms"
          checked={skipPerms}
          onChange={(e) => setSkipPerms(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-border accent-accent"
        />
        <label htmlFor="skip-perms" className="cursor-pointer text-[0.8125rem] text-muted">
          Skip permission prompts
        </label>
      </div>

      <div className="flex justify-end gap-2">
        <button
          onClick={() => {
            onCancel();
            setName("");
            setCwd("");
            setSkipPerms(false);
          }}
          className="rounded-lg px-3.5 py-1.5 text-[0.8125rem] text-muted transition-colors hover:bg-surface-hover hover:text-text"
        >
          Cancel
        </button>
        <button
          onClick={handleCreate}
          className="rounded-lg bg-accent px-3.5 py-1.5 text-[0.8125rem] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          Create
        </button>
      </div>
    </div>
  );
}
