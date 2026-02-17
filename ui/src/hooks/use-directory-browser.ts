import { useState, useRef } from "react";
import { browsePath, fetchDirectories } from "../lib/api";

export function useDirectoryBrowser() {
  const [homeDir, setHomeDir] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchHome = async () => {
    try {
      const data = await fetchDirectories();
      if (data.defaultDirectory) {
        setHomeDir(data.defaultDirectory);
      }
      return data.defaultDirectory || "";
    } catch {
      return "";
    }
  };

  const browse = (prefix: string) => {
    const target = prefix || homeDir;
    if (!target) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const data = await browsePath(target);
      if (!homeDir && data.home) setHomeDir(data.home);
      setSuggestions(data.directories || []);
      setActiveIndex(-1);
      setIsOpen((data.directories || []).length > 0);
    }, 100);
  };

  const close = () => {
    setIsOpen(false);
    setActiveIndex(-1);
  };

  return {
    homeDir,
    suggestions,
    activeIndex,
    setActiveIndex,
    isOpen,
    setIsOpen,
    fetchHome,
    browse,
    close,
  };
}
