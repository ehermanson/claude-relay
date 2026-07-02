import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { resetProjectOrderStoreForTests, useProjectOrder } from "./project-order-store";

const ORDER_CACHE_KEY = "relay:project-order";
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

  it("hydrates ordering from the server and caches it locally for bootstrap", () => {
    const { result } = renderHook(() => useProjectOrder());

    act(() => {
      result.current.hydrateFromServer(["/b", "/a"]);
    });

    expect(result.current.order).toEqual(["/b", "/a"]);
    expect(localStorage.getItem(ORDER_CACHE_KEY)).toBe(JSON.stringify(["/b", "/a"]));
  });

  it("bootstraps the initial order from the local cache before server hydration", () => {
    localStorage.setItem(ORDER_CACHE_KEY, JSON.stringify(["/b", "/a"]));
    resetProjectOrderStoreForTests();

    const { result } = renderHook(() => useProjectOrder());

    expect(result.current.hydrated).toBe(false);
    expect(result.current.order).toEqual(["/b", "/a"]);
    expect(
      result.current.sortEntries([
        ["/a", 1],
        ["/b", 2],
      ]),
    ).toEqual([
      ["/b", 2],
      ["/a", 1],
    ]);
    // Bootstrap alone must not echo anything to the server.
    expect(fetch).not.toHaveBeenCalled();
  });

  it("caches reorders locally so the next load boots in the new order", () => {
    const { result } = renderHook(() => useProjectOrder());

    act(() => {
      result.current.hydrateFromServer(["/a", "/b"]);
    });
    act(() => {
      result.current.moveToTop("/b");
    });

    expect(localStorage.getItem(ORDER_CACHE_KEY)).toBe(JSON.stringify(["/b", "/a"]));
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
