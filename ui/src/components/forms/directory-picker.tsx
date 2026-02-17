import { useRef, useEffect } from "react";
import { useDirectoryBrowser } from "../../hooks/use-directory-browser";

interface DirectoryPickerProps {
  value: string;
  onChange: (value: string) => void;
  onAutoName?: (name: string) => void;
}

export function DirectoryPicker({ value, onChange, onAutoName }: DirectoryPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { homeDir, suggestions, activeIndex, setActiveIndex, isOpen, fetchHome, browse, close } =
    useDirectoryBrowser();

  const selectDir = (dirPath: string) => {
    onChange(dirPath + "/");
    const dirName = dirPath.split("/").pop() || dirPath;
    onAutoName?.(dirName);
    close();
    browse(dirPath + "/");
  };

  const handleFocus = async () => {
    if (!value) {
      let home = homeDir;
      if (!home) home = await fetchHome();
      if (home) {
        onChange(home + "/");
        browse(home + "/");
      }
    } else {
      browse(value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Tab" && isOpen && suggestions.length > 0) {
      e.preventDefault();
      const idx = activeIndex >= 0 ? activeIndex : 0;
      if (suggestions[idx]) selectDir(suggestions[idx]);
      return;
    }

    if (!isOpen || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex(Math.min(activeIndex + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      if (suggestions[activeIndex]) selectDir(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      close();
    }
  };

  const handleBlur = () => {
    setTimeout(close, 150);
  };

  useEffect(() => {
    if (!isOpen) return;
    const items = inputRef.current?.parentElement?.querySelectorAll(".dir-picker-item");
    if (items && activeIndex >= 0 && items[activeIndex]) {
      items[activeIndex].scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, isOpen]);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          browse(e.target.value);
        }}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        placeholder={homeDir || "/path/to/project"}
        autoComplete="off"
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 font-mono text-[0.8125rem] text-text transition-colors placeholder:text-muted focus:border-accent focus:ring-1 focus:ring-accent-dim focus:outline-none"
      />
      {homeDir && <div className="mt-1 text-[0.6875rem] text-muted/60">Default: {homeDir}</div>}
      {isOpen && (
        <div className="absolute top-full right-0 left-0 z-10 mt-1 max-h-[200px] overflow-y-auto rounded-lg border border-border bg-surface-raised shadow-lg">
          {suggestions.map((dir, i) => (
            <div
              key={dir}
              className={`dir-picker-item cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap px-3 py-2 font-mono text-[0.8125rem] text-text transition-colors ${
                i === activeIndex ? "bg-accent-dim text-accent" : "hover:bg-surface-hover"
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectDir(dir);
              }}
            >
              {dir}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
