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
      <div className="mb-2.5 flex flex-col gap-1.5">
        <label className="text-[0.625rem] font-medium uppercase tracking-wider text-muted">
          Name (optional)
        </label>
        <input
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. My Project"
          className="w-full rounded border border-border bg-bg px-2.5 py-[7px] font-mono text-xs text-text transition-colors placeholder:text-muted focus:border-accent focus:shadow-[0_0_0_1px_var(--color-accent-dim)] focus:outline-none"
        />
      </div>

      <div className="mb-2.5 flex flex-col gap-1.5">
        <label className="text-[0.625rem] font-medium uppercase tracking-wider text-muted">
          Working Directory
        </label>
        <DirectoryPicker
          value={cwd}
          onChange={setCwd}
          onAutoName={(dirName) => {
            if (!name.trim()) setName(dirName);
          }}
        />
      </div>

      <div className="mb-2.5 flex items-center gap-2">
        <input
          type="checkbox"
          id="skip-perms"
          checked={skipPerms}
          onChange={(e) => setSkipPerms(e.target.checked)}
        />
        <label
          htmlFor="skip-perms"
          className="cursor-pointer text-[0.6875rem] text-muted"
        >
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
          className="rounded border border-border bg-transparent px-3 py-1.5 font-mono text-[0.6875rem] text-muted transition-all hover:border-border-hover hover:text-text"
        >
          Cancel
        </button>
        <button
          onClick={handleCreate}
          className="rounded border-none bg-accent px-3 py-1.5 font-mono text-[0.6875rem] font-semibold text-bg transition-all hover:bg-accent-hover"
        >
          Create
        </button>
      </div>
    </div>
  );
}
