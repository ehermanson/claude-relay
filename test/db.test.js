import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionDB } from "../dist/core/db.js";

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

function makeRow(overrides = {}) {
  return {
    session_id: "sess-1",
    instance_id: "inst-1",
    provider_name: "claude",
    name: "Test Session",
    working_directory: "/tmp/test",
    jsonl_path: "/tmp/test.jsonl",
    created_at: 1000,
    last_activity_at: 2000,
    type: "external",
    archived: 0,
    custom_title: 0,
    input_tokens: 100,
    output_tokens: 200,
    cache_creation_tokens: 50,
    cache_read_tokens: 30,
    cost_usd: 0.05,
    summary: null,
    first_prompt: null,
    git_branch: null,
    message_count: 0,
    allowed_tools: "[]",
    worktree_path: null,
    original_directory: null,
    parent_session_id: null,
    preferred_model: null,
    reasoning_budget: null,
    skip_permissions: 0,
    ...overrides,
  };
}

describe("SessionDB", () => {
  let tempDir;
  let db;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "relay-db-test-"));
    db = new SessionDB(join(tempDir, "sessions.db"), noopLogger);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("construction", () => {
    it("creates DB and tables on construction", () => {
      // DB was created in beforeEach; verify we can query the sessions table
      const rows = db.getAllActive();
      assert.ok(Array.isArray(rows));
      assert.equal(rows.length, 0);
    });
  });

  describe("upsert", () => {
    it("inserts a new row", () => {
      db.upsert(makeRow());
      const row = db.getBySessionId("sess-1");
      assert.ok(row);
      assert.equal(row.session_id, "sess-1");
      assert.equal(row.instance_id, "inst-1");
      assert.equal(row.name, "Test Session");
      assert.equal(row.working_directory, "/tmp/test");
      assert.equal(row.input_tokens, 100);
      assert.equal(row.output_tokens, 200);
    });

    it("updates on conflict (same session_id)", () => {
      db.upsert(makeRow());
      db.upsert(makeRow({ name: "Updated Name", input_tokens: 500 }));
      const row = db.getBySessionId("sess-1");
      assert.equal(row.name, "Updated Name");
      assert.equal(row.input_tokens, 500);
      // Should still be only one row
      assert.equal(db.getAllActive().length, 1);
    });
  });

  describe("getBySessionId", () => {
    it("returns the row for an existing session", () => {
      db.upsert(makeRow());
      const row = db.getBySessionId("sess-1");
      assert.ok(row);
      assert.equal(row.session_id, "sess-1");
    });

    it("returns undefined for a non-existent session", () => {
      assert.equal(db.getBySessionId("nonexistent"), undefined);
    });
  });

  describe("getByInstanceId", () => {
    it("returns the row for an existing instance", () => {
      db.upsert(makeRow());
      const row = db.getByInstanceId("inst-1");
      assert.ok(row);
      assert.equal(row.instance_id, "inst-1");
    });

    it("returns undefined for a non-existent instance", () => {
      assert.equal(db.getByInstanceId("nonexistent"), undefined);
    });
  });

  describe("getByJsonlPath", () => {
    it("returns the row for an existing jsonl path", () => {
      db.upsert(makeRow());
      const row = db.getByJsonlPath("/tmp/test.jsonl");
      assert.ok(row);
      assert.equal(row.jsonl_path, "/tmp/test.jsonl");
    });

    it("returns undefined for a non-existent path", () => {
      assert.equal(db.getByJsonlPath("/no/such/file.jsonl"), undefined);
    });
  });

  describe("getAllActive", () => {
    it("returns only non-archived rows", () => {
      db.upsert(makeRow({ session_id: "s1", instance_id: "i1", jsonl_path: "/a.jsonl" }));
      db.upsert(
        makeRow({ session_id: "s2", instance_id: "i2", jsonl_path: "/b.jsonl", archived: 1 }),
      );
      db.upsert(makeRow({ session_id: "s3", instance_id: "i3", jsonl_path: "/c.jsonl" }));

      const active = db.getAllActive();
      assert.equal(active.length, 2);
      const ids = active.map((r) => r.session_id);
      assert.ok(ids.includes("s1"));
      assert.ok(ids.includes("s3"));
      assert.ok(!ids.includes("s2"));
    });

    it("returns empty array when no rows exist", () => {
      assert.deepEqual(db.getAllActive(), []);
    });
  });

  describe("archive / unarchive", () => {
    it("archives a session", () => {
      db.upsert(makeRow());
      db.archive("sess-1");
      const row = db.getBySessionId("sess-1");
      assert.equal(row.archived, 1);
      assert.equal(db.getAllActive().length, 0);
    });

    it("unarchives a session", () => {
      db.upsert(makeRow({ archived: 1 }));
      assert.equal(db.getAllActive().length, 0);
      db.unarchive("sess-1");
      assert.equal(db.getAllActive().length, 1);
      const row = db.getBySessionId("sess-1");
      assert.equal(row.archived, 0);
    });
  });

  describe("updateStats", () => {
    it("updates token and cost stats", () => {
      db.upsert(makeRow());
      db.updateStats("sess-1", {
        inputTokens: 999,
        outputTokens: 888,
        cacheCreationTokens: 777,
        cacheReadTokens: 666,
        costUSD: 1.23,
      });
      const row = db.getBySessionId("sess-1");
      assert.equal(row.input_tokens, 999);
      assert.equal(row.output_tokens, 888);
      assert.equal(row.cache_creation_tokens, 777);
      assert.equal(row.cache_read_tokens, 666);
      assert.equal(row.cost_usd, 1.23);
    });
  });

  describe("updateLastActivity", () => {
    it("updates the last_activity_at timestamp", () => {
      db.upsert(makeRow());
      db.updateLastActivity("sess-1", 99999);
      const row = db.getBySessionId("sess-1");
      assert.equal(row.last_activity_at, 99999);
    });
  });

  describe("updateName", () => {
    it("updates name and custom_title flag", () => {
      db.upsert(makeRow());
      db.updateName("sess-1", "New Name", true);
      const row = db.getBySessionId("sess-1");
      assert.equal(row.name, "New Name");
      assert.equal(row.custom_title, 1);
    });

    it("clears custom_title when false", () => {
      db.upsert(makeRow({ custom_title: 1 }));
      db.updateName("sess-1", "Auto Name", false);
      const row = db.getBySessionId("sess-1");
      assert.equal(row.name, "Auto Name");
      assert.equal(row.custom_title, 0);
    });
  });

  describe("getJsonlPaths", () => {
    it("returns a Set of all jsonl paths", () => {
      db.upsert(makeRow({ session_id: "s1", instance_id: "i1", jsonl_path: "/a.jsonl" }));
      db.upsert(makeRow({ session_id: "s2", instance_id: "i2", jsonl_path: "/b.jsonl" }));
      db.upsert(makeRow({ session_id: "s3", instance_id: "i3", jsonl_path: "/c.jsonl" }));

      const paths = db.getJsonlPaths();
      assert.ok(paths instanceof Set);
      assert.equal(paths.size, 3);
      assert.ok(paths.has("/a.jsonl"));
      assert.ok(paths.has("/b.jsonl"));
      assert.ok(paths.has("/c.jsonl"));
    });

    it("returns empty set when no rows exist", () => {
      const paths = db.getJsonlPaths();
      assert.equal(paths.size, 0);
    });
  });

  describe("deleteBySessionId", () => {
    it("deletes a row by session_id", () => {
      db.upsert(makeRow());
      db.deleteBySessionId("sess-1");
      assert.equal(db.getBySessionId("sess-1"), undefined);
      assert.equal(db.getAllActive().length, 0);
    });

    it("does nothing for non-existent session", () => {
      db.deleteBySessionId("nonexistent");
      // Should not throw
    });
  });

  describe("clear", () => {
    it("removes all rows", () => {
      db.upsert(makeRow({ session_id: "s1", instance_id: "i1", jsonl_path: "/a.jsonl" }));
      db.upsert(makeRow({ session_id: "s2", instance_id: "i2", jsonl_path: "/b.jsonl" }));
      assert.equal(db.getAllActive().length, 2);
      db.clear();
      assert.equal(db.getAllActive().length, 0);
    });
  });

  describe("upsertMany", () => {
    it("inserts multiple rows in a transaction", () => {
      db.upsertMany([
        makeRow({ session_id: "s1", instance_id: "i1", jsonl_path: "/a.jsonl" }),
        makeRow({ session_id: "s2", instance_id: "i2", jsonl_path: "/b.jsonl" }),
        makeRow({ session_id: "s3", instance_id: "i3", jsonl_path: "/c.jsonl" }),
      ]);
      assert.equal(db.getAllActive().length, 3);
    });

    it("updates existing rows on conflict", () => {
      db.upsert(
        makeRow({ session_id: "s1", instance_id: "i1", jsonl_path: "/a.jsonl", name: "Old" }),
      );
      db.upsertMany([
        makeRow({ session_id: "s1", instance_id: "i1", jsonl_path: "/a.jsonl", name: "New" }),
        makeRow({ session_id: "s2", instance_id: "i2", jsonl_path: "/b.jsonl" }),
      ]);
      assert.equal(db.getAllActive().length, 2);
      assert.equal(db.getBySessionId("s1").name, "New");
    });
  });

  describe("getAll", () => {
    it("excludes archived by default", () => {
      db.upsert(makeRow({ session_id: "s1", instance_id: "i1", jsonl_path: "/a.jsonl" }));
      db.upsert(
        makeRow({ session_id: "s2", instance_id: "i2", jsonl_path: "/b.jsonl", archived: 1 }),
      );
      assert.equal(db.getAll().length, 1);
    });

    it("includes archived when requested", () => {
      db.upsert(makeRow({ session_id: "s1", instance_id: "i1", jsonl_path: "/a.jsonl" }));
      db.upsert(
        makeRow({ session_id: "s2", instance_id: "i2", jsonl_path: "/b.jsonl", archived: 1 }),
      );
      assert.equal(db.getAll(true).length, 2);
    });
  });
});
