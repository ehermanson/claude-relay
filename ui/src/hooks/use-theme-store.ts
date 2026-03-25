import { create } from "zustand";

type Theme = "dark" | "light";

const STORAGE_KEY = "relay-theme";

function loadTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Apply theme class to <html> and persist to localStorage. */
function applyTheme(theme: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("light", theme === "light");
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {}
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>()((set) => {
  const initial = loadTheme();
  applyTheme(initial);

  return {
    theme: initial,
    toggle: () =>
      set((s) => {
        const next = s.theme === "dark" ? "light" : "dark";
        applyTheme(next);
        return { theme: next };
      }),
  };
});

/** Drop-in replacement for the old useTheme() hook. */
export function useTheme() {
  return useThemeStore();
}
