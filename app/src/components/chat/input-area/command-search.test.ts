import { describe, expect, it } from "vitest";
import { searchProviderSkills, searchProviderSlashCommands } from "./command-search";

describe("command search", () => {
  it("ranks exact skill name matches ahead of description matches", () => {
    const results = searchProviderSkills(
      [
        { name: "frontend-design", description: "UI polish for landing pages" },
        { name: "ui", description: "Design UI components" },
      ],
      "ui",
    );

    expect(results.map((skill) => skill.name)).toEqual(["ui", "frontend-design"]);
  });

  it("omits disabled skills", () => {
    const results = searchProviderSkills(
      [
        { name: "ui", enabled: false },
        { name: "review-follow-up", enabled: true },
      ],
      "ui",
    );

    expect(results.map((skill) => skill.name)).toEqual([]);
  });

  it("ranks provider slash command names ahead of description-only matches", () => {
    const results = searchProviderSlashCommands(
      [
        { name: "frontend-design", description: "Help with UI work" },
        { name: "ui", description: "Run provider command" },
      ],
      "ui",
    );

    expect(results.map((command) => command.name)).toEqual(["ui", "frontend-design"]);
  });
});
