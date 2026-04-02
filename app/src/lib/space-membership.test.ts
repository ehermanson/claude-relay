import { describe, expect, it } from "vitest";
import { getResolvedSpaceId, isSpaceOwnedInstance } from "./space-membership";
import type { InstanceInfo } from "@shared/types";

function makeInstance(overrides: Partial<InstanceInfo> = {}): InstanceInfo {
  return {
    id: "chat-1",
    provider: "claude",
    name: "Chat",
    workingDirectory: "/repo",
    status: "stopped",
    createdAt: 1,
    lastActivityAt: 1,
    ...overrides,
  };
}

describe("space membership", () => {
  it("prefers the explicit spaceId when present", () => {
    const instance = makeInstance({ spaceId: "space-explicit" });
    expect(getResolvedSpaceId(instance)).toBe("space-explicit");
  });

  it("does not infer space membership from paths or branches in the client", () => {
    const instance = makeInstance({ workingDirectory: "/tmp/relay-space/worktree" });
    expect(getResolvedSpaceId(instance)).toBeUndefined();
  });

  it("does not treat the default space as a separate owned chat bucket", () => {
    const instance = makeInstance({ workingDirectory: "/repo" });
    expect(isSpaceOwnedInstance(instance)).toBe(false);
  });
});
