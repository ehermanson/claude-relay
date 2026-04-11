import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeSessionInitPayload } from "../dist/server/core/session-init.js";

describe("normalizeSessionInitPayload", () => {
  it("preserves slash command metadata from object payloads", () => {
    const payload = normalizeSessionInitPayload({
      slashCommands: [
        { name: "review", description: "Review a PR", argumentHint: "pr-or-branch" },
        "plain-command",
      ],
    });

    assert.deepEqual(payload?.slashCommands, [
      { name: "review", description: "Review a PR", input: { hint: "pr-or-branch" } },
      { name: "plain-command" },
    ]);
    assert.deepEqual(payload?.commands, ["review", "plain-command"]);
  });

  it("preserves skill metadata from object payloads", () => {
    const payload = normalizeSessionInitPayload({
      skills: [
        {
          name: "review-follow-up",
          description: "Review follow-up changes",
          shortDescription: "Review follow-up",
          invocationPrefix: "$",
          enabled: false,
        },
      ],
    });

    assert.deepEqual(payload?.skills, [
      {
        name: "review-follow-up",
        description: "Review follow-up changes",
        shortDescription: "Review follow-up",
        invocationPrefix: "$",
        enabled: false,
      },
    ]);
    assert.deepEqual(payload?.commands, ["review-follow-up"]);
  });
});
