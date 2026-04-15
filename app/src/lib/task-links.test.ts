import { describe, expect, it } from "vitest";
import { buildTaskReference } from "./task-links";

describe("buildTaskReference", () => {
  it("adds a trailing space so seeded drafts can continue typing normally", () => {
    expect(buildTaskReference({ id: "a1b2c3d4", title: "Fix login" })).toBe(
      "@task:a1b2c3d4:Fix%20login ",
    );
  });
});
