import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { resetProjectOrderStoreForTests, useProjectOrder } from "./project-order-store";

const COLLAPSED_KEY = "relay:project-collapsed";

function createFetchResponse() {
  return Promise.resolve({
    ok: true,
    json: async () => ({}),
  } as Response);
}

describe("useProjectOrder", () => {
  beforeEach(() => {
    localStorage.clear();
    resetProjectOrderStoreForTests();
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => createFetchResponse()),
    );
  });

  it("hydrates ordering from the server and does not persist order locally", () => {
    const { result } = renderHook(() => useProjectOrder());

    act(() => {
      result.current.hydrateFromServer(["/b", "/a"]);
    });

    expect(result.current.order).toEqual(["/b", "/a"]);
    expect(localStorage.getItem("relay:project-order")).toBeNull();
  });

  it("persists collapsed state per device", () => {
    const { result } = renderHook(() => useProjectOrder());

    act(() => {
      result.current.toggleCollapsed("/tmp/project");
    });

    expect(result.current.collapsed.has("/tmp/project")).toBe(true);
    expect(localStorage.getItem(COLLAPSED_KEY)).toBe(JSON.stringify(["/tmp/project"]));
  });

  it("does not append unknown projects until server order has hydrated", () => {
    const { result } = renderHook(() => useProjectOrder());

    act(() => {
      result.current.syncVisibleDirs(["/b", "/a"]);
    });

    expect(result.current.order).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();

    act(() => {
      result.current.hydrateFromServer(["/a"]);
    });

    act(() => {
      result.current.syncVisibleDirs(["/b", "/a"]);
    });

    expect(result.current.order).toEqual(["/a", "/b"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectOrder: ["/a", "/b"] }),
    });
  });
});
