import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ClientMessage } from "@shared/types";

// Configurable backing values for the mocked useWebSocket().
let rawSendImpl: (msg: ClientMessage) => boolean = () => true;
const rawSend = vi.fn((msg: ClientMessage) => rawSendImpl(msg));

vi.mock("../hooks/use-web-socket", () => ({
  useWebSocket: () => ({
    isConnected: true,
    isSyncing: false,
    connectionId: 1,
    instances: [],
    send: rawSend,
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    addMessageHandler: vi.fn(() => () => {}),
    reconnectNow: vi.fn(),
  }),
}));

// Import after the mock is in place.
import { WebSocketProvider, useWSMethods } from "./websocket-context";

function wrapper({ children }: { children: ReactNode }) {
  return <WebSocketProvider>{children}</WebSocketProvider>;
}

beforeEach(() => {
  rawSendImpl = () => true;
  rawSend.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WebSocketProvider awaiting-reply tracking", () => {
  it("arms the flag for non-internal instance_message and consumes once", () => {
    const { result } = renderHook(() => useWSMethods(), { wrapper });

    result.current.send({
      type: "instance_message",
      instanceId: "i1",
      text: "hi",
    });

    expect(result.current.consumeUserAwaitingReply("i1")).toBe(true);
    // Second consume returns false — flag was cleared.
    expect(result.current.consumeUserAwaitingReply("i1")).toBe(false);
  });

  it("does not arm the flag for internal instance_message", () => {
    const { result } = renderHook(() => useWSMethods(), { wrapper });

    result.current.send({
      type: "instance_message",
      instanceId: "i1",
      text: "[internal retry]",
      internal: true,
    });

    expect(result.current.consumeUserAwaitingReply("i1")).toBe(false);
  });

  it("does not arm the flag when the underlying socket rejects the send", () => {
    rawSendImpl = () => false;
    const { result } = renderHook(() => useWSMethods(), { wrapper });

    const accepted = result.current.send({
      type: "instance_message",
      instanceId: "i1",
      text: "hi",
    });

    expect(accepted).toBe(false);
    expect(result.current.consumeUserAwaitingReply("i1")).toBe(false);
  });

  it("clears the flag when the user cancels", () => {
    const { result } = renderHook(() => useWSMethods(), { wrapper });

    result.current.send({ type: "instance_message", instanceId: "i1", text: "hi" });
    expect(result.current.consumeUserAwaitingReply("i1")).toBe(true);

    // Re-arm, then cancel.
    result.current.send({ type: "instance_message", instanceId: "i1", text: "hi again" });
    result.current.send({ type: "instance_cancel", instanceId: "i1" });

    expect(result.current.consumeUserAwaitingReply("i1")).toBe(false);
  });

  it("clearUserAwaitingReply drops the flag without firing", () => {
    const { result } = renderHook(() => useWSMethods(), { wrapper });

    result.current.send({ type: "instance_message", instanceId: "i1", text: "hi" });
    result.current.clearUserAwaitingReply("i1");
    expect(result.current.consumeUserAwaitingReply("i1")).toBe(false);
  });

  it("tracks flags per-instance independently", () => {
    const { result } = renderHook(() => useWSMethods(), { wrapper });

    result.current.send({ type: "instance_message", instanceId: "a", text: "x" });
    result.current.send({ type: "instance_message", instanceId: "b", text: "y" });

    expect(result.current.consumeUserAwaitingReply("a")).toBe(true);
    expect(result.current.consumeUserAwaitingReply("b")).toBe(true);
    expect(result.current.consumeUserAwaitingReply("a")).toBe(false);
  });
});
