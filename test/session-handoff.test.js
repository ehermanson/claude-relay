import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildProviderSwitchHandoffPrompt } from "../dist/core/session-handoff.js";

describe("buildProviderSwitchHandoffPrompt", () => {
  it("builds a portable provider-switch prompt from recent conversation", () => {
    const prompt = buildProviderSwitchHandoffPrompt({
      sourceProvider: "codex",
      targetProvider: "claude",
      sourceName: "Fix model picker",
      workingDirectory: "/Users/test/projects/my-app",
      history: [
        {
          timestamp: 1,
          message: {
            type: "user",
            text: "We need to fix the provider switch flow.",
          },
        },
        {
          timestamp: 2,
          message: {
            type: "activity",
            activity: "tool_use",
            description: "Running command",
            tool: "Bash",
          },
        },
        {
          timestamp: 3,
          message: {
            type: "output",
            text: "I found the provider picker in input-area.tsx.",
            isWaiting: false,
          },
        },
        {
          timestamp: 4,
          message: {
            type: "transcript",
            title: "Background agent",
            result: "The issue is tied to create_instance handling.",
          },
        },
      ],
      changedFiles: [
        {
          path: "ui/src/components/chat/input-area.tsx",
          editCount: 2,
          type: "edited",
        },
      ],
    });

    assert.match(prompt, /new claude session that is taking over from a previous codex session/i);
    assert.match(prompt, /Working directory: \/Users\/test\/projects\/my-app/);
    assert.match(prompt, /Previous chat title: Fix model picker/);
    assert.match(prompt, /User: We need to fix the provider switch flow\./);
    assert.match(prompt, /Assistant: I found the provider picker in input-area\.tsx\./);
    assert.match(
      prompt,
      /Agent result \(Background agent\): The issue is tied to create_instance handling\./,
    );
    assert.match(prompt, /- ui\/src\/components\/chat\/input-area\.tsx/);
  });
});
