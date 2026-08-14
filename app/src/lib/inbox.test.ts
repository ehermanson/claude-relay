import { describe, expect, it } from "vitest";
import {
  buildInboxEntries,
  buildInboxProjectOptions,
  filterInboxEntries,
  partitionInboxEntries,
  selectStaleInboxEntries,
  STALE_CHAT_DONE_DAYS,
  type InboxSourceGroup,
} from "./inbox";
import type { InstanceInfo, SpaceInfo } from "@shared/types";

function chat(overrides: Partial<InstanceInfo> & { id: string }): InstanceInfo {
  return {
    provider: "claude",
    name: overrides.id,
    workingDirectory: "/tmp/project",
    status: "stopped",
    createdAt: 0,
    lastActivityAt: 1000,
    ...overrides,
  } as InstanceInfo;
}

function space(overrides: Partial<SpaceInfo> & { id: string }): SpaceInfo {
  return {
    name: overrides.id,
    projectDirectory: "/tmp/project",
    status: "active",
    isDefault: false,
    ...overrides,
  } as SpaceInfo;
}

function group(overrides: Partial<InboxSourceGroup> = {}): InboxSourceGroup {
  return {
    dir: "/tmp/project",
    name: "project",
    projectId: "project",
    groupInstances: [],
    spaces: [],
    ...overrides,
  };
}

describe("buildInboxEntries", () => {
  it("flattens every project into one list, newest activity first", () => {
    const entries = buildInboxEntries([
      group({
        dir: "/a",
        name: "alpha",
        groupInstances: [chat({ id: "old", lastActivityAt: 10 })],
      }),
      group({ dir: "/b", name: "beta", groupInstances: [chat({ id: "new", lastActivityAt: 90 })] }),
    ]);

    expect(entries.map((e) => e.instance.id)).toEqual(["new", "old"]);
    expect(entries[0].projectName).toBe("beta");
    expect(entries[1].dir).toBe("/a");
  });

  it("sorts pinned chats above more recent unpinned ones", () => {
    const entries = buildInboxEntries([
      group({
        groupInstances: [
          chat({ id: "recent", lastActivityAt: 900 }),
          chat({ id: "pinned", lastActivityAt: 5, pinned: true }),
        ],
      }),
    ]);

    expect(entries.map((e) => e.instance.id)).toEqual(["pinned", "recent"]);
  });

  it("prefers the last message timestamp over lastActivityAt for recency", () => {
    const entries = buildInboxEntries([
      group({
        groupInstances: [
          chat({ id: "stale-activity", lastActivityAt: 500 }),
          chat({
            id: "fresh-message",
            lastActivityAt: 1,
            lastMessage: { text: "hi", from: "assistant", timestamp: 900 },
          }),
        ],
      }),
    ]);

    expect(entries.map((e) => e.instance.id)).toEqual(["fresh-message", "stale-activity"]);
  });

  it("omits review chats attached to another chat", () => {
    const entries = buildInboxEntries([
      group({
        groupInstances: [
          chat({ id: "main" }),
          chat({
            id: "review",
            review: { sourceInstanceId: "main", sourceName: "main", scope: "branch" },
          }),
        ],
      }),
    ]);

    expect(entries.map((e) => e.instance.id)).toEqual(["main"]);
  });

  it("attaches the owning space and marks closed-space chats done", () => {
    const entries = buildInboxEntries([
      group({
        groupInstances: [
          chat({ id: "in-open", spaceId: "open", lastActivityAt: 300 }),
          chat({ id: "in-merged", spaceId: "merged", lastActivityAt: 200 }),
          chat({ id: "standalone", lastActivityAt: 100 }),
        ],
        spaces: [space({ id: "open" }), space({ id: "merged", status: "completed" })],
      }),
    ]);

    const byId = new Map(entries.map((e) => [e.instance.id, e]));
    expect(byId.get("in-open")?.space?.id).toBe("open");
    expect(byId.get("in-open")?.done).toBe(false);
    // Merged work shouldn't keep surfacing in the inbox.
    expect(byId.get("in-merged")?.done).toBe(true);
    expect(byId.get("standalone")?.space).toBeUndefined();
  });

  it("treats a chat as done only until it has newer activity", () => {
    const entries = buildInboxEntries([
      group({
        groupInstances: [
          chat({ id: "settled", doneAt: 500, lastActivityAt: 400 }),
          chat({ id: "revived", doneAt: 500, lastActivityAt: 600 }),
        ],
      }),
    ]);

    const byId = new Map(entries.map((e) => [e.instance.id, e]));
    expect(byId.get("settled")?.done).toBe(true);
    expect(byId.get("revived")?.done).toBe(false);
  });
});

describe("filterInboxEntries", () => {
  const entries = buildInboxEntries([
    group({ dir: "/a", groupInstances: [chat({ id: "a1" })] }),
    group({ dir: "/b", groupInstances: [chat({ id: "b1" })] }),
  ]);

  it("returns every project when no filter is set", () => {
    expect(filterInboxEntries(entries, null)).toHaveLength(2);
  });

  it("scopes to a single project directory", () => {
    expect(filterInboxEntries(entries, "/b").map((e) => e.instance.id)).toEqual(["b1"]);
  });

  it("yields nothing for a directory that no longer has chats", () => {
    expect(filterInboxEntries(entries, "/gone")).toEqual([]);
  });
});

describe("partitionInboxEntries", () => {
  it("splits done chats out while preserving order within each side", () => {
    const entries = buildInboxEntries([
      group({
        groupInstances: [
          chat({ id: "live-new", lastActivityAt: 900 }),
          chat({ id: "done-new", lastActivityAt: 800, doneAt: 900 }),
          chat({ id: "live-old", lastActivityAt: 300 }),
          chat({ id: "done-old", lastActivityAt: 100, doneAt: 900 }),
        ],
      }),
    ]);

    const { active, done } = partitionInboxEntries(entries);
    expect(active.map((e) => e.instance.id)).toEqual(["live-new", "live-old"]);
    expect(done.map((e) => e.instance.id)).toEqual(["done-new", "done-old"]);
  });

  it("orders the done section by recency alone, ignoring pins", () => {
    const entries = buildInboxEntries([
      group({
        groupInstances: [
          chat({ id: "done-pinned", pinned: true, lastActivityAt: 100, doneAt: 900 }),
          chat({ id: "done-recent", lastActivityAt: 800, doneAt: 900 }),
        ],
      }),
    ]);

    const { done } = partitionInboxEntries(entries);
    expect(done.map((e) => e.instance.id)).toEqual(["done-recent", "done-pinned"]);
  });
});

describe("selectStaleInboxEntries", () => {
  const NOW = 100 * 24 * 60 * 60 * 1000;
  const DAY = 24 * 60 * 60 * 1000;
  const stale = NOW - (STALE_CHAT_DONE_DAYS + 1) * DAY;
  const fresh = NOW - (STALE_CHAT_DONE_DAYS - 1) * DAY;

  function select(instances: InstanceInfo[]) {
    const { active } = partitionInboxEntries(
      buildInboxEntries([group({ groupInstances: instances })]),
    );
    return selectStaleInboxEntries(active, NOW).map((e) => e.instance.id);
  }

  it("picks only chats past the inactivity cutoff", () => {
    expect(
      select([
        chat({ id: "old", lastActivityAt: stale }),
        chat({ id: "recent", lastActivityAt: fresh }),
      ]),
    ).toEqual(["old"]);
  });

  it("measures staleness from the last message when it leads lastActivityAt", () => {
    expect(
      select([
        chat({
          id: "messaged-recently",
          lastActivityAt: stale,
          lastMessage: { text: "hi", from: "assistant", timestamp: fresh },
        }),
      ]),
    ).toEqual([]);
  });

  it("leaves a working agent alone however long the chat has been open", () => {
    expect(select([chat({ id: "busy", status: "processing", lastActivityAt: stale })])).toEqual([]);
  });

  it("skips chats with no recorded activity rather than treating them as ancient", () => {
    expect(select([chat({ id: "unknown", lastActivityAt: undefined })])).toEqual([]);
  });

  it("never re-marks chats that are already done", () => {
    const entries = buildInboxEntries([
      group({ groupInstances: [chat({ id: "done", lastActivityAt: stale, doneAt: NOW })] }),
    ]);
    expect(selectStaleInboxEntries(entries, NOW)).toEqual([]);
  });
});

describe("buildInboxProjectOptions", () => {
  it("prefers the registered project id, falling back to an instance's", () => {
    const options = buildInboxProjectOptions([
      group({ dir: "/a", name: "alpha", project: { id: "uuid-a" } }),
      group({ dir: "/b", name: "beta", groupInstances: [chat({ id: "b1", projectId: "uuid-b" })] }),
      group({ dir: "/c", name: "gamma" }),
    ]);

    expect(options.map((o) => o.dbId)).toEqual(["uuid-a", "uuid-b", undefined]);
    expect(options.map((o) => o.name)).toEqual(["alpha", "beta", "gamma"]);
  });
});
