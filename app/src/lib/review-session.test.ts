import { describe, expect, it } from "vitest";
import {
  buildReviewDraft,
  buildReviewSendBackMessage,
  getAttachedReviewInstances,
  getReviewSourceInstance,
} from "./review-session";
import type { FileChange, InstanceInfo } from "@shared/types";

function makeInstance(overrides: Partial<InstanceInfo>): InstanceInfo {
  return {
    id: "inst-1",
    provider: "claude",
    name: "Source Chat",
    workingDirectory: "/tmp/project",
    status: "idle",
    createdAt: 1,
    lastActivityAt: 1,
    ...overrides,
  };
}

describe("getReviewSourceInstance", () => {
  it("prefers sourceInstanceId when available", () => {
    const source = makeInstance({ id: "source-1", sessionId: "session-1" });
    const review = makeInstance({
      id: "review-1",
      review: {
        sourceInstanceId: "source-1",
        sourceSessionId: "session-1",
        sourceName: "Source Chat",
        scope: "session-files",
      },
      parentSessionId: "session-1",
    });

    expect(getReviewSourceInstance(review, [review, source])).toBe(source);
  });

  it("falls back to sourceSessionId within the same working directory", () => {
    const source = makeInstance({ id: "source-1", sessionId: "session-1" });
    const review = makeInstance({
      id: "review-1",
      review: {
        sourceSessionId: "session-1",
        sourceName: "Source Chat",
        scope: "branch",
      },
      parentSessionId: "session-1",
    });

    expect(getReviewSourceInstance(review, [review, source])).toBe(source);
  });
});

describe("buildReviewDraft", () => {
  it("includes explicit session-touched files in a <source_files> block", () => {
    const draft = buildReviewDraft({
      sourceName: "Source Chat",
      review: {
        sourceName: "Source Chat",
        scope: "session-files",
        filePaths: ["app/src/foo.ts", "server/bar.ts"],
      },
    });

    expect(draft).toContain('Review the recent changes from "Source Chat"');
    expect(draft).toContain("<source_files>\napp/src/foo.ts\nserver/bar.ts\n</source_files>");
  });

  it("falls back to touched file objects when file paths are omitted", () => {
    const touchedFiles: FileChange[] = [{ path: "app/src/foo.ts", editCount: 1, type: "edited" }];
    const draft = buildReviewDraft({
      sourceName: "Source Chat",
      review: {
        sourceName: "Source Chat",
        scope: "session-files",
      },
      touchedFiles,
    });

    expect(draft).toContain("<source_files>\napp/src/foo.ts\n</source_files>");
  });

  it("appends trimmed extra instructions when provided", () => {
    const draft = buildReviewDraft({
      sourceName: "Source Chat",
      review: {
        sourceName: "Source Chat",
        scope: "branch",
      },
      instructions: "  Focus on the migration edge cases.  ",
    });

    expect(draft).toContain(
      "Additional instructions for this review:\nFocus on the migration edge cases.",
    );
  });

  it("omits the instructions section when instructions are blank", () => {
    const draft = buildReviewDraft({
      sourceName: "Source Chat",
      review: {
        sourceName: "Source Chat",
        scope: "branch",
      },
      instructions: "   ",
    });

    expect(draft).not.toContain("Additional instructions");
  });

  it("builds a branch review prompt for branch scope", () => {
    const draft = buildReviewDraft({
      sourceName: "Source Chat",
      review: {
        sourceName: "Source Chat",
        scope: "branch",
      },
    });

    expect(draft).toContain("Read the full reviewable diff for this branch/worktree");
  });
});

describe("buildReviewSendBackMessage", () => {
  it("wraps review markdown with source context", () => {
    const message = buildReviewSendBackMessage({
      reviewName: "Review: Source Chat",
      sourceName: "Source Chat",
      message: "# Findings\n\n- Issue",
    });

    expect(message).toContain("[Review from: Review: Source Chat]");
    expect(message).toContain('For source chat "Source Chat":');
    expect(message).toContain("# Findings");
  });
});

describe("getAttachedReviewInstances", () => {
  it("returns attached reviews sorted newest-first", () => {
    const source = makeInstance({ id: "source-1", sessionId: "session-1", createdAt: 10 });
    const older = makeInstance({
      id: "review-1",
      name: "Review: older",
      createdAt: 20,
      lastActivityAt: 20,
      review: {
        sourceInstanceId: "source-1",
        sourceSessionId: "session-1",
        sourceName: "Source Chat",
        scope: "branch",
      },
      parentSessionId: "session-1",
    });
    const newer = makeInstance({
      id: "review-2",
      name: "Review: newer",
      createdAt: 30,
      lastActivityAt: 30,
      review: {
        sourceInstanceId: "source-1",
        sourceSessionId: "session-1",
        sourceName: "Source Chat",
        scope: "branch",
      },
      parentSessionId: "session-1",
    });

    expect(
      getAttachedReviewInstances(source, [source, older, newer]).map((item) => item.id),
    ).toEqual(["review-2", "review-1"]);
  });
});
