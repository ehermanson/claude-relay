import { describe, expect, it } from "vitest";
import {
  LARGE_JSON_RENDER_CHAR_THRESHOLD,
  classifyLargeUserText,
  shouldSkipShrinkwrapForText,
} from "./message-rendering";

describe("shouldSkipShrinkwrapForText", () => {
  it("skips shrinkwrap for very long text", () => {
    expect(shouldSkipShrinkwrapForText("x".repeat(4_001))).toBe(true);
  });

  it("skips shrinkwrap for very tall text", () => {
    expect(shouldSkipShrinkwrapForText(Array.from({ length: 201 }, () => "x").join("\n"))).toBe(
      true,
    );
  });

  it("keeps shrinkwrap for normal messages", () => {
    expect(shouldSkipShrinkwrapForText("short message")).toBe(false);
  });
});

describe("classifyLargeUserText", () => {
  it("classifies large valid JSON as json", () => {
    const source = JSON.stringify({
      items: Array.from({ length: 800 }, (_, i) => ({ id: i, name: `item-${i}` })),
    });
    expect(source.length).toBeGreaterThanOrEqual(LARGE_JSON_RENDER_CHAR_THRESHOLD);

    const result = classifyLargeUserText(source);
    expect(result.kind).toBe("json");
    expect(result.formattedText).toContain('"items"');
    expect(result.lineCount).toBeGreaterThan(1);
  });

  it("keeps smaller JSON on the markdown path", () => {
    expect(classifyLargeUserText('{"ok":true}')).toEqual({ kind: "markdown" });
  });

  it("keeps large invalid JSON on the markdown path", () => {
    const invalid = `{${"x".repeat(LARGE_JSON_RENDER_CHAR_THRESHOLD)}}`;
    expect(classifyLargeUserText(invalid).kind).toBe("markdown");
  });
});
