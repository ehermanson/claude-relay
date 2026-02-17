import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeToolUse, describeToolDetail } from "../dist/tools.js";

describe("describeToolUse", () => {
  it("returns 'Reading file' for Read", () => {
    assert.equal(describeToolUse("Read", { file_path: "/tmp/x" }), "Reading file");
  });

  it("returns 'Editing file' for Edit", () => {
    assert.equal(describeToolUse("Edit", { file_path: "/tmp/x" }), "Editing file");
  });

  it("returns 'Writing file' for Write", () => {
    assert.equal(describeToolUse("Write", { file_path: "/tmp/x" }), "Writing file");
  });

  it("returns 'Running command' for Bash", () => {
    assert.equal(describeToolUse("Bash", { command: "ls" }), "Running command");
  });

  it("returns 'Searching files' for Glob", () => {
    assert.equal(describeToolUse("Glob", { pattern: "*.js" }), "Searching files");
  });

  it("returns 'Searching content' for Grep", () => {
    assert.equal(describeToolUse("Grep", { pattern: "TODO" }), "Searching content");
  });

  it("returns 'Fetching URL' for WebFetch", () => {
    assert.equal(describeToolUse("WebFetch", { url: "https://example.com" }), "Fetching URL");
  });

  it("returns 'Searching web' for WebSearch", () => {
    assert.equal(describeToolUse("WebSearch", { query: "node.js" }), "Searching web");
  });

  it("returns 'Running subtask' for Task", () => {
    assert.equal(describeToolUse("Task", { description: "do stuff" }), "Running subtask");
  });

  it("returns 'Using <name>' for unknown tool with input", () => {
    assert.equal(describeToolUse("CustomTool", { foo: "bar" }), "Using CustomTool");
  });

  it("returns 'Using <name>' when input is undefined", () => {
    assert.equal(describeToolUse("Read"), "Using Read");
    assert.equal(describeToolUse("Bash"), "Using Bash");
    assert.equal(describeToolUse("CustomTool"), "Using CustomTool");
  });
});

describe("describeToolDetail", () => {
  it("returns undefined when input is undefined", () => {
    assert.equal(describeToolDetail("Read"), undefined);
    assert.equal(describeToolDetail("Bash"), undefined);
    assert.equal(describeToolDetail("CustomTool"), undefined);
  });

  it("extracts file_path for Read", () => {
    assert.equal(describeToolDetail("Read", { file_path: "/home/user/file.ts" }), "/home/user/file.ts");
  });

  it("extracts file_path for Edit", () => {
    assert.equal(describeToolDetail("Edit", { file_path: "/tmp/edit.ts" }), "/tmp/edit.ts");
  });

  it("extracts file_path for Write", () => {
    assert.equal(describeToolDetail("Write", { file_path: "/tmp/write.ts" }), "/tmp/write.ts");
  });

  it("falls back to path for file tools", () => {
    assert.equal(describeToolDetail("Read", { path: "/fallback/path.ts" }), "/fallback/path.ts");
  });

  it("extracts short command for Bash", () => {
    assert.equal(describeToolDetail("Bash", { command: "ls -la" }), "ls -la");
  });

  it("truncates long commands for Bash", () => {
    const longCmd = "a".repeat(150);
    const result = describeToolDetail("Bash", { command: longCmd });
    assert.equal(result, "a".repeat(100) + "...");
    assert.equal(result.length, 103);
  });

  it("returns undefined for Bash with no command", () => {
    assert.equal(describeToolDetail("Bash", {}), undefined);
  });

  it("extracts pattern for Glob", () => {
    assert.equal(describeToolDetail("Glob", { pattern: "**/*.ts" }), "**/*.ts");
  });

  it("extracts pattern for Grep", () => {
    assert.equal(describeToolDetail("Grep", { pattern: "TODO" }), "TODO");
  });

  it("extracts url for WebFetch", () => {
    assert.equal(describeToolDetail("WebFetch", { url: "https://example.com/api" }), "https://example.com/api");
  });

  it("extracts query for WebSearch", () => {
    assert.equal(describeToolDetail("WebSearch", { query: "node test runner" }), "node test runner");
  });

  it("returns undefined for unknown tool", () => {
    assert.equal(describeToolDetail("CustomTool", { foo: "bar" }), undefined);
  });
});
