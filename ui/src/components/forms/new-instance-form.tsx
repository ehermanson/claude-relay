import { useState, useRef, useEffect } from "react";
import type { ProviderKind } from "@shared/types";
import { DirectoryPicker } from "./directory-picker";
import { Input } from "../ui/input";
import { CheckboxField } from "../ui/checkbox";
import { Button } from "../ui/button";

interface NewInstanceFormProps {
  onSubmit: (options: {
    provider?: ProviderKind;
    name?: string;
    workingDirectory?: string;
    dangerouslySkipPermissions?: boolean;
  }) => void;
  onCancel: () => void;
}

export function NewInstanceForm({ onSubmit, onCancel }: NewInstanceFormProps) {
  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [provider, setProvider] = useState<ProviderKind>("claude");
  const [skipPerms, setSkipPerms] = useState(true);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleCreate = () => {
    const payload: {
      provider?: ProviderKind;
      name?: string;
      workingDirectory?: string;
      dangerouslySkipPermissions?: boolean;
    } = {};
    if (provider !== "claude") payload.provider = provider;
    if (name.trim()) payload.name = name.trim();
    if (cwd.trim()) payload.workingDirectory = cwd.trim();
    if (skipPerms) payload.dangerouslySkipPermissions = true;
    onSubmit(payload);
    setName("");
    setCwd("");
    setProvider("claude");
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
        <label className="text-[0.6875rem] font-medium text-muted">Provider</label>
        <div className="flex gap-2">
          <Button
            variant={provider === "claude" ? "primary" : "ghost"}
            className="flex-1"
            onClick={() => setProvider("claude")}
          >
            Claude
          </Button>
          <Button
            variant={provider === "codex" ? "primary" : "ghost"}
            className="flex-1"
            onClick={() => setProvider("codex")}
          >
            Codex
          </Button>
        </div>
        {provider === "codex" && (
          <p className="text-[0.6875rem] text-muted">
            Managed Codex sessions use `codex exec` today. Approval prompts and external-session
            parity are still in progress.
          </p>
        )}
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
          label={
            provider === "codex" ? "Disable Codex sandbox and approvals" : "Skip permission prompts"
          }
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            onCancel();
            setName("");
            setCwd("");
            setProvider("claude");
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
