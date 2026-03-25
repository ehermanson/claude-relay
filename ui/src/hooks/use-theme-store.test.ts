import { describe, it, expect, beforeEach } from "vitest";
import { useThemeStore } from "./use-theme-store";

const STORAGE_KEY = "relay-theme";

function reset() {
  localStorage.clear();
  document.documentElement.classList.remove("light");
  useThemeStore.setState({ theme: "dark" });
}

describe("useThemeStore", () => {
  beforeEach(reset);

  it("defaults to dark theme", () => {
    expect(useThemeStore.getState().theme).toBe("dark");
  });

  it("toggles between dark and light", () => {
    const { toggle } = useThemeStore.getState();

    toggle();
    expect(useThemeStore.getState().theme).toBe("light");

    toggle();
    expect(useThemeStore.getState().theme).toBe("dark");
  });

  it("persists theme to localStorage on toggle", () => {
    const { toggle } = useThemeStore.getState();

    toggle();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");

    toggle();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
  });

  it("applies light class to documentElement when light", () => {
    const { toggle } = useThemeStore.getState();

    toggle();
    expect(document.documentElement.classList.contains("light")).toBe(true);

    toggle();
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });
});
