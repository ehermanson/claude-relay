import { describe, expect, it } from "vitest";
import { classifyLargeUserText, shouldSkipShrinkwrapForText } from "./message-rendering";

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
      items: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `item-${i}` })),
    });
    const result = classifyLargeUserText(source);
    expect(result.kind).toBe("json");
    expect(result.formattedText).toContain('"items"');
    expect(result.lineCount).toBeGreaterThan(1);
  });

  it("keeps small JSON on the markdown path", () => {
    expect(classifyLargeUserText('{"ok":true}')).toEqual({ kind: "markdown" });
  });

  it("classifies very large valid JSON as json even above the old parse cap", () => {
    const source = JSON.stringify({
      items: Array.from({ length: 4000 }, (_, i) => ({ id: i, value: `value-${i}` })),
    });
    const result = classifyLargeUserText(source);
    expect(result.kind).toBe("json");
    expect((result.charCount ?? 0) > 200_000).toBe(true);
  });

  it("keeps large invalid JSON on the markdown path", () => {
    const invalid = `{${"x".repeat(5_000)}}`;
    expect(classifyLargeUserText(invalid).kind).toBe("markdown");
  });

  it("classifies non-JSON large blobs as text", () => {
    const largeText = Array.from({ length: 500 }, (_, i) => `line ${i}`).join("\n");
    const result = classifyLargeUserText(largeText);
    expect(result.kind).toBe("text");
    expect(result.lineCount).toBe(500);
  });
});
