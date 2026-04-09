import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSidecarStore, useSidecarPanels } from "./sidecar-store";

function reset() {
  useSidecarStore.setState({
    chatPanels: new Set(),
    spacePanels: new Set(),
    sidebarWidth: null,
    mobileOpen: false,
  });
}

describe("useSidecarStore", () => {
  beforeEach(reset);

  describe("togglePanel", () => {
    it("activates a panel in the chat scope", () => {
      useSidecarStore.getState().togglePanel("chat", "tasks");
      expect(useSidecarStore.getState().chatPanels.has("tasks")).toBe(true);
    });

    it("deactivates a panel on second toggle", () => {
      const { togglePanel } = useSidecarStore.getState();
      togglePanel("chat", "tasks");
      togglePanel("chat", "tasks");
      expect(useSidecarStore.getState().chatPanels.has("tasks")).toBe(false);
    });

    it("keeps chat and space scopes isolated", () => {
      const { togglePanel } = useSidecarStore.getState();
      togglePanel("chat", "tasks");
      togglePanel("space", "files");

      expect(useSidecarStore.getState().chatPanels.has("tasks")).toBe(true);
      expect(useSidecarStore.getState().chatPanels.has("files")).toBe(false);
      expect(useSidecarStore.getState().spacePanels.has("files")).toBe(true);
      expect(useSidecarStore.getState().spacePanels.has("tasks")).toBe(false);
    });
  });

  describe("setMobileOpen", () => {
    it("sets the global mobile overlay state", () => {
      useSidecarStore.getState().setMobileOpen(true);
      expect(useSidecarStore.getState().mobileOpen).toBe(true);
    });
  });

  describe("setSidebarWidth", () => {
    it("stores the shared sidebar width", () => {
      useSidecarStore.getState().setSidebarWidth(420);
      expect(useSidecarStore.getState().sidebarWidth).toBe(420);
    });
  });
});

describe("useSidecarPanels hook", () => {
  beforeEach(reset);

  it("returns correct sidecarContentCount", () => {
    const { result } = renderHook(() =>
      useSidecarPanels({
        scope: "chat",
        isMobile: false,
        hasTasksContent: true,
        hasFilesContent: true,
        hasPlanContent: false,
        hasStats: true,
      }),
    );
    expect(result.current.sidecarContentCount).toBe(3);
  });

  it("returns allContentPanels based on content flags", () => {
    const { result } = renderHook(() =>
      useSidecarPanels({
        scope: "chat",
        isMobile: false,
        hasTasksContent: true,
        hasFilesContent: false,
        hasPlanContent: true,
        hasStats: false,
      }),
    );
    expect(result.current.allContentPanels.has("tasks")).toBe(true);
    expect(result.current.allContentPanels.has("plan")).toBe(true);
    expect(result.current.allContentPanels.has("files")).toBe(false);
    expect(result.current.allContentPanels.has("context")).toBe(false);
  });

  it("shows desktop sidecar when an active panel has content", () => {
    // Seed the chat preference with tasks on
    act(() => useSidecarStore.getState().togglePanel("chat", "tasks"));

    const { result } = renderHook(() =>
      useSidecarPanels({
        scope: "chat",
        isMobile: false,
        hasTasksContent: true,
        hasFilesContent: false,
        hasPlanContent: false,
        hasStats: false,
      }),
    );

    expect(result.current.showDesktopSidecar).toBe(true);
  });

  it("hides desktop sidecar when the active panel has no content", () => {
    act(() => useSidecarStore.getState().togglePanel("chat", "tasks"));

    const { result } = renderHook(() =>
      useSidecarPanels({
        scope: "chat",
        isMobile: false,
        hasTasksContent: false,
        hasFilesContent: false,
        hasPlanContent: false,
        hasStats: false,
      }),
    );

    expect(result.current.showDesktopSidecar).toBe(false);
  });

  it("hides desktop sidecar on mobile", () => {
    act(() => useSidecarStore.getState().togglePanel("chat", "tasks"));

    const { result } = renderHook(() =>
      useSidecarPanels({
        scope: "chat",
        isMobile: true,
        hasTasksContent: true,
        hasFilesContent: false,
        hasPlanContent: false,
        hasStats: false,
      }),
    );

    expect(result.current.showDesktopSidecar).toBe(false);
  });

  it("togglePanel toggles and updates showDesktopSidecar", () => {
    act(() => useSidecarStore.getState().togglePanel("chat", "tasks"));

    const { result } = renderHook(() =>
      useSidecarPanels({
        scope: "chat",
        isMobile: false,
        hasTasksContent: true,
        hasFilesContent: false,
        hasPlanContent: false,
        hasStats: false,
      }),
    );

    expect(result.current.showDesktopSidecar).toBe(true);

    act(() => result.current.togglePanel("tasks"));
    expect(result.current.showDesktopSidecar).toBe(false);
  });

  it("chat and space scopes do not share panel state", () => {
    act(() => useSidecarStore.getState().togglePanel("chat", "tasks"));

    const { result: chat } = renderHook(() =>
      useSidecarPanels({
        scope: "chat",
        isMobile: false,
        hasTasksContent: true,
        hasFilesContent: false,
        hasPlanContent: false,
        hasStats: false,
      }),
    );

    const { result: space } = renderHook(() =>
      useSidecarPanels({
        scope: "space",
        isMobile: false,
        hasTasksContent: true,
        hasFilesContent: false,
        hasPlanContent: false,
        hasStats: false,
      }),
    );

    expect(chat.current.activePanels.has("tasks")).toBe(true);
    expect(space.current.activePanels.has("tasks")).toBe(false);
  });
});
