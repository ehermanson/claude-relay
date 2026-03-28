import { useState, useEffect, useRef } from "react";
import { Folder, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useDirectoryBrowser } from "../../hooks/use-directory-browser";

interface CreateProjectFormProps {
  onSubmit: (parentDirectory: string, name: string) => void;
  onCancel: () => void;
  error?: string | null;
  isSubmitting?: boolean;
}

export function CreateProjectForm({
  onSubmit,
  onCancel,
  error,
  isSubmitting,
}: CreateProjectFormProps) {
  const [parentDir, setParentDir] = useState("");
  const [name, setName] = useState("");
  const parentRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const browser = useDirectoryBrowser();

  // Fetch home dir on mount and set as default
  useEffect(() => {
    browser.fetchHome().then((home) => {
      if (home) {
        setParentDir(home);
        browser.browse(home);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleParentChange = (value: string) => {
    setParentDir(value);
    browser.browse(value);
  };

  const handleSelectDir = (dir: string) => {
    setParentDir(dir);
    browser.close();
  };

  const handleParentKeyDown = (e: React.KeyboardEvent) => {
    if (!browser.isOpen) {
      if (e.key === "Escape") onCancel();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      browser.setActiveIndex((i) => Math.min(i + 1, browser.suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      browser.setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && browser.activeIndex >= 0) {
      e.preventDefault();
      handleSelectDir(browser.suggestions[browser.activeIndex]);
    } else if (e.key === "Escape") {
      browser.close();
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (browser.activeIndex < 0) return;
    const items = listRef.current?.querySelectorAll(".dir-item");
    if (items?.[browser.activeIndex]) {
      items[browser.activeIndex].scrollIntoView({ block: "nearest" });
    }
  }, [browser.activeIndex]);

  const canSubmit = parentDir.trim() && name.trim() && !isSubmitting;

  const handleSubmit = () => {
    if (canSubmit) onSubmit(parentDir.trim(), name.trim());
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-1.5">
        <label className="text-[0.75rem] font-medium text-muted" htmlFor="create-parent-dir">
          Location
        </label>
        <Input
          ref={parentRef}
          id="create-parent-dir"
          value={parentDir}
          onChange={(e) => handleParentChange(e.target.value)}
          onKeyDown={handleParentKeyDown}
          onFocus={() => {
            if (parentDir) browser.browse(parentDir);
          }}
          placeholder="/path/to/parent"
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />
        {browser.isOpen && browser.suggestions.length > 0 && (
          <div
            ref={listRef}
            className="max-h-[180px] overflow-y-auto rounded-lg border border-border bg-surface-raised"
          >
            {browser.suggestions.map((dir, i) => {
              const dirName = dir.split("/").pop() || dir;
              return (
                <button
                  key={dir}
                  type="button"
                  className={`dir-item flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                    i === browser.activeIndex ? "bg-accent-dim" : "hover:bg-surface-hover"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectDir(dir);
                  }}
                  onMouseEnter={() => browser.setActiveIndex(i)}
                >
                  <Folder size={13} className="shrink-0 text-muted" />
                  <span
                    className={`truncate text-[0.8125rem] ${i === browser.activeIndex ? "text-accent" : "text-text"}`}
                  >
                    {dirName}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-[0.75rem] font-medium text-muted" htmlFor="create-project-name">
          Project name
        </label>
        <Input
          id="create-project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") onCancel();
          }}
          placeholder="my-project"
          autoComplete="off"
          spellCheck={false}
        />
        {parentDir && name && (
          <p className="truncate text-[0.6875rem] text-muted/60">
            {parentDir.replace(/\/$/, "")}/{name}
          </p>
        )}
      </div>

      {error && <p className="text-[0.6875rem] text-red-400">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleSubmit} disabled={!canSubmit}>
          {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : "Create"}
        </Button>
      </div>
    </div>
  );
}
