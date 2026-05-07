import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstanceInfo } from "@shared/types";
import { useTurnEndToasts } from "./use-turn-end-toasts";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

let instances: InstanceInfo[] = [];
const consumeUserAwaitingReply = vi.fn();
const clearUserAwaitingReply = vi.fn();
vi.mock("../context/websocket-context", () => ({
  useWSState: () => ({ instances }),
  useWSMethods: () => ({ consumeUserAwaitingReply, clearUserAwaitingReply }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstance(overrides: Partial<InstanceInfo> = {}): InstanceInfo {
  return {
    id: "i1",
    provider: "claude" as InstanceInfo["provider"],
    name: "test chat",
    workingDirectory: "/tmp/x",
    status: "processing",
    createdAt: 0,
    lastActivityAt: 0,
    ...overrides,
  } as InstanceInfo;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  instances = [];
  toastSuccess.mockReset();
  toastError.mockReset();
  navigateMock.mockReset();
  consumeUserAwaitingReply.mockReset();
  clearUserAwaitingReply.mockReset();
  consumeUserAwaitingReply.mockReturnValue(true);
  setVisibility("visible");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useTurnEndToasts", () => {
  it("does not toast on initial load (no prior status to compare)", () => {
    instances = [makeInstance({ status: "idle" })];
    renderHook(() => useTurnEndToasts(undefined));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(consumeUserAwaitingReply).not.toHaveBeenCalled();
  });

  it("toasts on processing → idle transition for a non-focused chat", () => {
    instances = [makeInstance({ status: "processing" })];
    const { rerender } = renderHook(({ id }: { id?: string }) => useTurnEndToasts(id), {
      initialProps: { id: "other" },
    });
    instances = [makeInstance({ status: "idle" })];
    rerender({ id: "other" });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("test chat", expect.objectContaining({}));
  });

  it("does not toast when the chat is focused and the tab is visible", () => {
    instances = [makeInstance({ status: "processing" })];
    const { rerender } = renderHook(({ id }: { id?: string }) => useTurnEndToasts(id), {
      initialProps: { id: "i1" },
    });
    instances = [makeInstance({ status: "idle" })];
    rerender({ id: "i1" });
    expect(toastSuccess).not.toHaveBeenCalled();
    // Flag is still consumed so a later turn doesn't fire a stale toast.
    expect(consumeUserAwaitingReply).toHaveBeenCalledWith("i1");
  });

  it("toasts even for the focused chat when the tab is hidden", () => {
    instances = [makeInstance({ status: "processing" })];
    const { rerender } = renderHook(({ id }: { id?: string }) => useTurnEndToasts(id), {
      initialProps: { id: "i1" },
    });
    setVisibility("hidden");
    instances = [makeInstance({ status: "idle" })];
    rerender({ id: "i1" });
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("uses toast.error on processing → error", () => {
    instances = [makeInstance({ status: "processing" })];
    const { rerender } = renderHook(() => useTurnEndToasts("other"));
    instances = [makeInstance({ status: "error" })];
    rerender();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("does not toast while a tool/permission is pending", () => {
    instances = [makeInstance({ status: "processing" })];
    const { rerender } = renderHook(() => useTurnEndToasts("other"));
    instances = [makeInstance({ status: "idle", pendingTool: "Bash" })];
    rerender();
    expect(toastSuccess).not.toHaveBeenCalled();
    // Awaiting-reply flag must remain — the real turn end is still ahead.
    expect(consumeUserAwaitingReply).not.toHaveBeenCalled();
  });

  it("does not toast for external (terminal) sessions", () => {
    instances = [makeInstance({ status: "processing", external: true })];
    const { rerender } = renderHook(() => useTurnEndToasts("other"));
    instances = [makeInstance({ status: "idle", external: true })];
    rerender();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("does not toast when the user has not sent a tracked message", () => {
    consumeUserAwaitingReply.mockReturnValue(false);
    instances = [makeInstance({ status: "processing" })];
    const { rerender } = renderHook(() => useTurnEndToasts("other"));
    instances = [makeInstance({ status: "idle" })];
    rerender();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("clears the awaiting-reply flag on processing → stopped (no toast)", () => {
    instances = [makeInstance({ status: "processing" })];
    const { rerender } = renderHook(() => useTurnEndToasts("other"));
    instances = [makeInstance({ status: "stopped" })];
    rerender();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(clearUserAwaitingReply).toHaveBeenCalledWith("i1");
    expect(consumeUserAwaitingReply).not.toHaveBeenCalled();
  });
});
