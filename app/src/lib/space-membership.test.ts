import { describe, expect, it } from "vitest";
import { getResolvedSpaceId, isSpaceOwnedInstance } from "./space-membership";
import type { InstanceInfo, SpaceInfo } from "@shared/types";

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

function makeSpace(overrides: Partial<SpaceInfo> = {}): SpaceInfo {
  return {
    id: "space-1",
    name: "Space",
    projectDirectory: "/repo",
    gitBranch: null,
    worktreePath: null,
    status: "active",
    isDefault: false,
    createdAt: 1,
    lastActivityAt: 1,
    chatCount: 0,
    ...overrides,
  };
}

describe("space membership", () => {
  it("prefers the explicit spaceId when present", () => {
    const instance = makeInstance({ spaceId: "space-explicit" });
    expect(getResolvedSpaceId(instance, [makeSpace()])).toBe("space-explicit");
  });

  it("infers space membership from the worktree path", () => {
    const space = makeSpace({ worktreePath: "/tmp/relay-space/worktree" });
    const instance = makeInstance({ workingDirectory: "/tmp/relay-space/worktree" });
    expect(getResolvedSpaceId(instance, [space])).toBe(space.id);
  });

  it("infers space membership from the original repo plus branch", () => {
    const space = makeSpace({ gitBranch: "relay-space/feature" });
    const instance = makeInstance({
      workingDirectory: "/tmp/relay-space/worktree",
      originalDirectory: "/repo",
      gitBranch: "relay-space/feature",
    });
    expect(getResolvedSpaceId(instance, [space])).toBe(space.id);
  });

  it("does not treat the default space as a separate owned chat bucket", () => {
    const space = makeSpace({ id: "default", isDefault: true, worktreePath: "/repo" });
    const instance = makeInstance({ workingDirectory: "/repo" });
    expect(isSpaceOwnedInstance(instance, [space])).toBe(false);
  });
});
