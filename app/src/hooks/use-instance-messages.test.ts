import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useInstanceMessages } from "@/hooks/use-instance-messages";
import type { ActivityMessage, OutputMessage, UserMessage } from "@shared/types";

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
