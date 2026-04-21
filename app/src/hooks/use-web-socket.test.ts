import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWebSocket } from "./use-web-socket";

const HANDSHAKE_TIMEOUT = 10_000;

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; wasClean: boolean }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send() {}

  close() {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
}

describe("useWebSocket reconnect behavior", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        protocol: "http:",
        host: "relay.test",
        href: "http://relay.test/",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.stubGlobal("WebSocket", originalWebSocket);
  });

  it("replaces a stuck connecting socket after the handshake timeout", () => {
    renderHook(() => useWebSocket());

    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(HANDSHAKE_TIMEOUT + 1);
    });

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.instances[0]?.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("manual retry replaces a socket even when it is already closing", () => {
    const { result } = renderHook(() => useWebSocket());
    const first = MockWebSocket.instances[0];

    expect(first).toBeDefined();
    if (!first) throw new Error("expected initial websocket instance");

    first.readyState = MockWebSocket.CLOSING;

    act(() => {
      result.current.reconnectNow();
    });

    expect(MockWebSocket.instances).toHaveLength(2);
    expect(first.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("clears the handshake timeout once the socket opens", () => {
    renderHook(() => useWebSocket());
    const first = MockWebSocket.instances[0];

    expect(first).toBeDefined();
    if (!first) throw new Error("expected initial websocket instance");

    act(() => {
      first.emitOpen();
      vi.advanceTimersByTime(HANDSHAKE_TIMEOUT + 1);
    });

    expect(MockWebSocket.instances).toHaveLength(1);
  });
});
