import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/use-theme-store";
import { Tooltip } from "./tooltip";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();

  return (
    <Tooltip content={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
      <button
        onClick={toggle}
        className={`flex items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-text ${className}`}
      >
        {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
      </button>
    </Tooltip>
  );
}
