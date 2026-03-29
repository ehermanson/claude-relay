import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useInstanceMessages } from "@/hooks/use-instance-messages";
import type {
  ActivityMessage,
  InstanceStatusMessage,
  OutputMessage,
  UserMessage,
} from "@shared/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal InstanceInfo stub — only the fields the reducer inspects. */
function stubInstanceStatus(
  instanceId: string,
  overrides: Record<string, unknown> = {},
): InstanceStatusMessage {
  return {
    type: "instance_status",
    instanceId,
    instance: {
      id: instanceId,
      status: "idle",
      name: "test",
      workingDirectory: "/tmp",
      createdAt: 0,
      lastActivityAt: 0,
      ...overrides,
    } as InstanceStatusMessage["instance"],
  };
}

describe("useInstanceMessages sequence dedupe", () => {
  it("ignores duplicate sequenced user messages", () => {
    const { result } = renderHook(() => useInstanceMessages());

    act(() => {
      result.current.setInstanceId("instance-1");
    });

    const message: UserMessage = {
      type: "user",
      instanceId: "instance-1",
      text: "hello",
      eventSequence: 7,
    };

    act(() => {
      result.current.handleMessage("instance-1", message);
      result.current.handleMessage("instance-1", message);
    });

    expect(result.current.items).toEqual([
      expect.objectContaining({ kind: "user", text: "hello" }),
    ]);
  });

  it("ignores duplicate sequenced thinking activities", () => {
    const { result } = renderHook(() => useInstanceMessages());

    act(() => {
      result.current.setInstanceId("instance-1");
    });

    const message: ActivityMessage = {
      type: "activity",
      instanceId: "instance-1",
      activity: "thinking",
      description: "Thinking...",
      detail: "considering options",
      eventSequence: 8,
    };

    act(() => {
      result.current.handleMessage("instance-1", message);
      result.current.handleMessage("instance-1", message);
    });

    expect(result.current.items).toEqual([{ kind: "thinking-block", text: "considering options" }]);
  });

  it("ignores duplicate sequenced output chunks", () => {
    const { result } = renderHook(() => useInstanceMessages());

    act(() => {
      result.current.setInstanceId("instance-1");
    });

    const message: OutputMessage = {
      type: "output",
      instanceId: "instance-1",
      text: "world",
      isWaiting: false,
      eventSequence: 9,
    };

    act(() => {
      result.current.handleMessage("instance-1", message);
      result.current.handleMessage("instance-1", message);
    });

    expect(result.current.items).toEqual([
      expect.objectContaining({ kind: "assistant", text: "world" }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Message queue behaviour
// ---------------------------------------------------------------------------

describe("useInstanceMessages message queue", () => {
  it("renders a queued user message with queued flag", () => {
    const { result } = renderHook(() => useInstanceMessages());
    act(() => result.current.setInstanceId("inst-1"));

    const msg: UserMessage = {
      type: "user",
      instanceId: "inst-1",
      text: "queued hello",
      queued: true,
    };

    act(() => result.current.handleMessage("inst-1", msg));

    expect(result.current.items).toEqual([
      expect.objectContaining({ kind: "user", text: "queued hello", queued: true }),
    ]);
  });

  it("replaces queued placeholders when the coalesced real message arrives", () => {
    const { result } = renderHook(() => useInstanceMessages());
    act(() => result.current.setInstanceId("inst-1"));

    // Simulate two queued messages arriving during processing
    act(() => {
      result.current.handleMessage("inst-1", {
        type: "user",
        instanceId: "inst-1",
        text: "first queued",
        queued: true,
      } as UserMessage);
      result.current.handleMessage("inst-1", {
        type: "user",
        instanceId: "inst-1",
        text: "second queued",
        queued: true,
      } as UserMessage);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0]).toEqual(
      expect.objectContaining({ queued: true, text: "first queued" }),
    );

    // Queue drains — server sends one coalesced non-queued user message
    act(() => {
      result.current.handleMessage("inst-1", {
        type: "user",
        instanceId: "inst-1",
        text: "first queued\n\nsecond queued",
      } as UserMessage);
    });

    // Should have exactly one non-queued message, no duplicates
    const userItems = result.current.items.filter((i) => i.kind === "user");
    expect(userItems).toHaveLength(1);
    expect(userItems[0]).toEqual(
      expect.objectContaining({
        kind: "user",
        text: "first queued\n\nsecond queued",
        queued: undefined,
      }),
    );
  });

  it("clears queued placeholders when instance_status reports queue empty", () => {
    const { result } = renderHook(() => useInstanceMessages());
    act(() => result.current.setInstanceId("inst-1"));

    // Add a normal message then a queued one
    act(() => {
      result.current.handleMessage("inst-1", {
        type: "user",
        instanceId: "inst-1",
        text: "normal message",
      } as UserMessage);
      result.current.handleMessage("inst-1", {
        type: "user",
        instanceId: "inst-1",
        text: "queued message",
        queued: true,
      } as UserMessage);
    });

    expect(result.current.items).toHaveLength(2);

    // Server clears queue (e.g. user pressed stop) and broadcasts status
    act(() => {
      result.current.handleMessage(
        "inst-1",
        stubInstanceStatus("inst-1", { queuedMessageCount: undefined }),
      );
    });

    // Only the normal message should remain
    expect(result.current.items).toEqual([
      expect.objectContaining({ kind: "user", text: "normal message" }),
    ]);
  });

  it("clear_queued is a no-op when nothing is queued", () => {
    const { result } = renderHook(() => useInstanceMessages());
    act(() => result.current.setInstanceId("inst-1"));

    act(() => {
      result.current.handleMessage("inst-1", {
        type: "user",
        instanceId: "inst-1",
        text: "normal",
      } as UserMessage);
    });

    const itemsBefore = result.current.items;

    // Status update with no queue — should not trigger a re-render
    act(() => {
      result.current.handleMessage(
        "inst-1",
        stubInstanceStatus("inst-1", { queuedMessageCount: undefined }),
      );
    });

    // Same reference — reducer returned previous state (no-op)
    expect(result.current.items).toBe(itemsBefore);
  });

  it("does not clear queued items when instance_status still has a queue count", () => {
    const { result } = renderHook(() => useInstanceMessages());
    act(() => result.current.setInstanceId("inst-1"));

    act(() => {
      result.current.handleMessage("inst-1", {
        type: "user",
        instanceId: "inst-1",
        text: "queued",
        queued: true,
      } as UserMessage);
    });

    // Status update that still reports a queue
    act(() => {
      result.current.handleMessage(
        "inst-1",
        stubInstanceStatus("inst-1", { queuedMessageCount: 1 }),
      );
    });

    expect(result.current.items).toEqual([
      expect.objectContaining({ kind: "user", text: "queued", queued: true }),
    ]);
  });
});
