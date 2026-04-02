import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSidecarStore, useSidecarPanels } from "./sidecar-store";

function reset() {
  useSidecarStore.setState({ instances: {} });
}

describe("useSidecarStore", () => {
  beforeEach(reset);

  describe("togglePanel", () => {
    it("activates a panel", () => {
      const { togglePanel } = useSidecarStore.getState();

      togglePanel("inst-1", "tasks");

      const inst = useSidecarStore.getState().instances["inst-1"];
      expect(inst.activePanels.has("tasks")).toBe(true);
    });

    it("deactivates a panel on second toggle", () => {
      const { togglePanel } = useSidecarStore.getState();

      togglePanel("inst-1", "tasks");
      togglePanel("inst-1", "tasks");

      const inst = useSidecarStore.getState().instances["inst-1"];
      expect(inst.activePanels.has("tasks")).toBe(false);
    });

    it("tracks manually toggled-off panels", () => {
      const { togglePanel } = useSidecarStore.getState();

      togglePanel("inst-1", "files");
      togglePanel("inst-1", "files"); // toggle off

      const inst = useSidecarStore.getState().instances["inst-1"];
      expect(inst.manuallyToggledOff.has("files")).toBe(true);
    });

    it("clears manually toggled-off when re-activated", () => {
      const { togglePanel } = useSidecarStore.getState();

      togglePanel("inst-1", "files");
      togglePanel("inst-1", "files"); // off
      togglePanel("inst-1", "files"); // back on

      const inst = useSidecarStore.getState().instances["inst-1"];
      expect(inst.manuallyToggledOff.has("files")).toBe(false);
      expect(inst.activePanels.has("files")).toBe(true);
    });
  });

  describe("syncContent", () => {
    it("auto-activates panels when content first appears", () => {
      const { syncContent } = useSidecarStore.getState();

      syncContent("inst-1", true, false, false, false);

      const inst = useSidecarStore.getState().instances["inst-1"];
      expect(inst.activePanels.has("tasks")).toBe(true);
      expect(inst.activePanels.has("files")).toBe(false);
    });

    it("does not re-activate a manually dismissed panel", () => {
      const { syncContent, togglePanel } = useSidecarStore.getState();

      // Content appears → auto-activate
      syncContent("inst-1", true, false, false, false);
      // User dismisses
      togglePanel("inst-1", "tasks");
      // Content goes away then comes back
      syncContent("inst-1", false, false, false, false);
      syncContent("inst-1", true, false, false, false);

      const inst = useSidecarStore.getState().instances["inst-1"];
      expect(inst.activePanels.has("tasks")).toBe(false);
    });

    it("auto-activates multiple panels at once", () => {
      const { syncContent } = useSidecarStore.getState();

      syncContent("inst-1", true, true, true, false);

      const inst = useSidecarStore.getState().instances["inst-1"];
      expect(inst.activePanels.has("tasks")).toBe(true);
      expect(inst.activePanels.has("files")).toBe(true);
      expect(inst.activePanels.has("plan")).toBe(true);
    });

    it("skips update when nothing changed", () => {
      const { syncContent } = useSidecarStore.getState();

      syncContent("inst-1", true, false, false, false);
      const stateAfterFirst = useSidecarStore.getState();

      syncContent("inst-1", true, false, false, false);
      const stateAfterSecond = useSidecarStore.getState();

      // Should be referentially identical (no unnecessary re-render)
      expect(stateAfterFirst).toBe(stateAfterSecond);
    });
  });

  describe("resetInstance", () => {
    it("clears all state for an instance", () => {
      const { togglePanel, syncContent, resetInstance } = useSidecarStore.getState();

      syncContent("inst-1", true, true, false, false);
      togglePanel("inst-1", "plan");

      resetInstance("inst-1");

      const inst = useSidecarStore.getState().instances["inst-1"];
      expect(inst.activePanels.size).toBe(0);
      expect(inst.manuallyToggledOff.size).toBe(0);
      expect(inst.mobileOpen).toBe(false);
    });
  });

  describe("instance isolation", () => {
    it("keeps state separate between instances", () => {
      const { togglePanel } = useSidecarStore.getState();

      togglePanel("inst-1", "tasks");
      togglePanel("inst-2", "files");

      const inst1 = useSidecarStore.getState().instances["inst-1"];
      const inst2 = useSidecarStore.getState().instances["inst-2"];

      expect(inst1.activePanels.has("tasks")).toBe(true);
      expect(inst1.activePanels.has("files")).toBe(false);
      expect(inst2.activePanels.has("files")).toBe(true);
      expect(inst2.activePanels.has("tasks")).toBe(false);
    });
  });

  describe("setMobileOpen", () => {
    it("sets mobile overlay state per instance", () => {
      const { setMobileOpen } = useSidecarStore.getState();

      setMobileOpen("inst-1", true);

      expect(useSidecarStore.getState().instances["inst-1"].mobileOpen).toBe(true);
    });
  });
});

describe("useSidecarPanels hook", () => {
  beforeEach(reset);

  it("returns correct sidecarContentCount", () => {
    const { result } = renderHook(() =>
      useSidecarPanels({
        instanceId: "inst-1",
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
        instanceId: "inst-1",
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

  it("shows desktop sidecar when active panel has content", async () => {
    const { result } = renderHook(() =>
      useSidecarPanels({
        instanceId: "inst-1",
        isMobile: false,
        hasTasksContent: true,
        hasFilesContent: false,
        hasPlanContent: false,
        hasStats: false,
      }),
    );

    // syncContent runs in useEffect — wait for it to flush
    await act(async () => {});
    expect(result.current.showDesktopSidecar).toBe(true);
  });

  it("hides desktop sidecar on mobile", async () => {
    const { result } = renderHook(() =>
      useSidecarPanels({
        instanceId: "inst-1",
        isMobile: true,
        hasTasksContent: true,
        hasFilesContent: false,
        hasPlanContent: false,
        hasStats: false,
      }),
    );

    await act(async () => {});
    expect(result.current.showDesktopSidecar).toBe(false);
  });

  it("togglePanel toggles and updates showDesktopSidecar", async () => {
    const { result } = renderHook(() =>
      useSidecarPanels({
        instanceId: "inst-1",
        isMobile: false,
        hasTasksContent: true,
        hasFilesContent: false,
        hasPlanContent: false,
        hasStats: false,
      }),
    );

    // syncContent runs in useEffect — wait for auto-activation
    await act(async () => {});
    expect(result.current.showDesktopSidecar).toBe(true);

    // Toggle off
    act(() => result.current.togglePanel("tasks"));
    expect(result.current.showDesktopSidecar).toBe(false);
  });
});
