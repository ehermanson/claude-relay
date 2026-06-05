import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import { $getRoot, createEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { $isFileMentionNode, FILE_MENTION_TRANSFORMER, FileMentionNode } from "./file-mention-node";
import { EDITOR_NODES } from "./markdown-editor";

/**
 * Round-trip markdown through the same node set + transformers the editor uses,
 * via a headless Lexical editor (no DOM). Locks the fidelity contract for the
 * instructions fields: what a user authors must survive serialization back to
 * the `.md` string the server persists.
 */
function roundTrip(markdown: string): string {
  const editor = createEditor({
    namespace: "markdown-editor-test",
    nodes: EDITOR_NODES,
    onError: (error) => {
      throw error;
    },
  });

  let result = "";
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, TRANSFORMERS);
    },
    { discrete: true },
  );
  editor.read(() => {
    result = $convertToMarkdownString(TRANSFORMERS);
  });
  return result;
}

describe("MarkdownEditor round-trip", () => {
  const cases: Array<[string, string]> = [
    ["heading", "# Title"],
    ["bold + italic", "Use **strict** mode and *prefer* hooks."],
    ["inline code", "Run `pnpm build` before tests."],
    ["unordered list", "- one\n- two\n- three"],
    ["ordered list", "1. first\n2. second"],
    ["blockquote", "> Be concise."],
    ["link", "See [the docs](https://example.com)."],
    [
      "mixed document",
      "# Instructions\n\nAlways use **TypeScript** strict mode.\n\n- Prefer `functional` components\n- Avoid `any`\n\n> Keep responses concise.",
    ],
  ];

  for (const [name, markdown] of cases) {
    it(`preserves ${name} on round-trip`, () => {
      expect(roundTrip(markdown)).toBe(markdown);
    });
  }

  it("is idempotent across a second round-trip", () => {
    const once = roundTrip(cases[cases.length - 1][1]);
    expect(roundTrip(once)).toBe(once);
  });
});

/**
 * Round-trip with the mention transformer + FileMentionNode registered, the way
 * MarkdownEditor runs when `searchFiles` is provided.
 */
function mentionRoundTrip(markdown: string): { markdown: string; mentionPaths: string[] } {
  const editor = createEditor({
    namespace: "markdown-editor-mention-test",
    nodes: [...EDITOR_NODES, FileMentionNode],
    onError: (error) => {
      throw error;
    },
  });
  const transformers = [FILE_MENTION_TRANSFORMER, ...TRANSFORMERS];

  let result = "";
  const mentionPaths: string[] = [];
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, transformers);
    },
    { discrete: true },
  );
  editor.read(() => {
    result = $convertToMarkdownString(transformers);
    const collect = (node: ReturnType<typeof $getRoot>) => {
      for (const child of node.getChildren()) {
        if ($isFileMentionNode(child)) mentionPaths.push(child.getPath());
        else if ("getChildren" in child) collect(child as never);
      }
    };
    collect($getRoot());
  });
  return { markdown: result, mentionPaths };
}

describe("MarkdownEditor file mentions", () => {
  it("imports a path-like @token as a chip and serializes it back to the path", () => {
    const { markdown, mentionPaths } = mentionRoundTrip("See @src/lib/api.ts for details.");
    expect(mentionPaths).toEqual(["src/lib/api.ts"]);
    expect(markdown).toBe("See @src/lib/api.ts for details.");
  });

  it("treats a bare @token (no slash or extension) as prose, not a mention", () => {
    const { markdown, mentionPaths } = mentionRoundTrip("Pass the @param to the handler.");
    expect(mentionPaths).toEqual([]);
    expect(markdown).toBe("Pass the @param to the handler.");
  });

  it("recognizes an extensioned file in the project root", () => {
    const { mentionPaths } = mentionRoundTrip("Update @README.md please.");
    expect(mentionPaths).toEqual(["README.md"]);
  });
});
