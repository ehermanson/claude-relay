import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import {
  exportRelayArchive,
  exportRelayData,
  importRelayArchive,
  importRelayData,
  SessionDB,
} from "../dist/core/index.js";

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };
const hasTar = (() => {
  try {
    execFileSync("tar", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

function makeSessionRow(overrides = {}) {
  return {
    session_id: "sess-1",
    instance_id: "inst-1",
    provider_name: "claude",
    name: "Claude Session",
    working_directory: "/tmp/project-a",
    jsonl_path: "/tmp/source.jsonl",
    created_at: 1000,
    last_activity_at: 2000,
    type: "external",
    archived: 0,
    custom_title: 0,
    input_tokens: 10,
    output_tokens: 20,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    summary: null,
    first_prompt: null,
    git_branch: null,
    message_count: 1,
    allowed_tools: "[]",
    worktree_path: null,
    original_directory: null,
    parent_session_id: null,
    preferred_model: null,
    reasoning_budget: null,
    skip_permissions: 0,
    last_message_text: null,
    last_message_from: null,
    last_message_at: null,
    git_info_branch: null,
    git_info_is_worktree: null,
    space_id: "space-imported",
    project_id: "project-imported",
    model: null,
    ...overrides,
  };
}

function makeManagedRow(overrides = {}) {
  return {
    instance_id: "managed-1",
    provider_name: "codex",
    provider_session_id: "codex-session-1",
    name: "Codex Session",
    working_directory: "/tmp/project-a",
    created_at: 1000,
    last_activity_at: 3000,
    archived: 0,
    custom_title: 0,
    input_tokens: 1,
    output_tokens: 2,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    git_branch: null,
    worktree_path: null,
    original_directory: null,
    parent_session_id: null,
    preferred_model: null,
    reasoning_budget: null,
    skip_permissions: 0,
    runtime_mode: "default",
    resume_cursor_json: JSON.stringify({ sessionId: "codex-session-1" }),
    runtime_payload_json: JSON.stringify({ cwd: "/tmp/project-a", transcript: "/tmp/codex.jsonl" }),
    transcript_path: "/tmp/codex.jsonl",
    last_message_text: null,
    last_message_from: null,
    last_message_at: null,
    git_info_branch: null,
    git_info_is_worktree: null,
    space_id: "space-imported",
    project_id: "project-imported",
    model: null,
    ...overrides,
  };
}

function makeProjectRow(overrides = {}) {
  return {
    id: "project-imported",
    name: "Imported Project",
    directory: "/tmp/project-a",
    repo_root: "/tmp/project-a",
    remote_url: null,
    target_branch: "main",
    created_at: 1000,
    last_activity_at: 4000,
    ...overrides,
  };
}

function makeSpaceRow(overrides = {}) {
  return {
    id: "space-imported",
    project_directory: "/tmp/project-a",
    name: "main",
    git_branch: "main",
    worktree_path: null,
    is_default: 1,
    status: "active",
    created_at: 1000,
    last_activity_at: 4000,
    ...overrides,
  };
}

describe("migration export/import", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "relay-migration-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("exports a bundle and imports it into another machine layout", async () => {
    const sourceRoot = join(tempDir, "source");
    const targetRoot = join(tempDir, "target");
    const bundleDir = join(tempDir, "bundle");
    const sourceClaudeDir = join(sourceRoot, ".claude");
    const sourceCodexDir = join(sourceRoot, ".codex");
    const targetClaudeDir = join(targetRoot, ".claude");
    const targetCodexDir = join(targetRoot, ".codex");
    const sourceClaudeTranscript = join(sourceClaudeDir, "projects", "project-a", "sess-1.jsonl");
    const sourceCodexTranscript = join(
      sourceCodexDir,
      "sessions",
      "2026",
      "03",
      "codex-session-1.jsonl",
    );
    const targetClaudeTranscript = join(targetClaudeDir, "projects", "project-a", "sess-1.jsonl");
    const targetCodexTranscript = join(
      targetCodexDir,
      "sessions",
      "2026",
      "03",
      "codex-session-1.jsonl",
    );

    mkdirSync(dirname(sourceClaudeTranscript), { recursive: true });
    mkdirSync(dirname(sourceCodexTranscript), { recursive: true });
    mkdirSync(dirname(targetClaudeTranscript), { recursive: true });
    mkdirSync(dirname(targetCodexTranscript), { recursive: true });

    writeFileSync(sourceClaudeTranscript, '{"type":"message"}\n{"type":"message","text":"more"}\n');
    writeFileSync(sourceCodexTranscript, '{"id":"1"}\n');
    writeFileSync(targetClaudeTranscript, '{"type":"message"}\n');
    writeFileSync(targetCodexTranscript, '{"id":"1"}\n');

    const sourceDb = new SessionDB(join(sourceRoot, ".relay", "sessions.db"), noopLogger);
    sourceDb.upsertProject(makeProjectRow());
    sourceDb.upsertSpace(makeSpaceRow());
    sourceDb.upsert(
      makeSessionRow({
        jsonl_path: sourceClaudeTranscript,
      }),
    );
    sourceDb.upsertManaged(
      makeManagedRow({
        transcript_path: sourceCodexTranscript,
        runtime_payload_json: JSON.stringify({
          cwd: "/tmp/project-a",
          transcriptPath: sourceCodexTranscript,
        }),
      }),
    );
    sourceDb.close();

    const targetDb = new SessionDB(join(targetRoot, ".relay", "sessions.db"), noopLogger);
    targetDb.upsertProject(
      makeProjectRow({
        id: "project-local",
        name: "Local Project",
      }),
    );
    targetDb.upsertSpace(
      makeSpaceRow({
        id: "space-local",
        name: "main",
      }),
    );
    targetDb.close();

    const exported = await exportRelayData(
      {
        dbPath: join(sourceRoot, ".relay", "sessions.db"),
        providerDirs: {
          claude: sourceClaudeDir,
          codex: sourceCodexDir,
        },
        logger: noopLogger,
      },
      bundleDir,
    );

    assert.equal(exported.dbIncluded, true);
    assert.equal(exported.claudeTranscriptFiles, 1);
    assert.equal(exported.codexTranscriptFiles, 1);

    const imported = importRelayData(
      {
        dbPath: join(targetRoot, ".relay", "sessions.db"),
        providerDirs: {
          claude: targetClaudeDir,
          codex: targetCodexDir,
        },
        logger: noopLogger,
      },
      bundleDir,
    );

    assert.equal(imported.transcriptFilesUpdated, 1);
    assert.equal(imported.transcriptFilesSkipped, 1);
    assert.equal(imported.sessionRowsMerged, 1);
    assert.equal(imported.managedRowsMerged, 1);
    assert.equal(imported.projectsMerged, 1);
    assert.equal(imported.spacesMerged, 1);

    assert.equal(
      readFileSync(targetClaudeTranscript, "utf-8"),
      '{"type":"message"}\n{"type":"message","text":"more"}\n',
    );
    assert.equal(readFileSync(targetCodexTranscript, "utf-8"), '{"id":"1"}\n');

    const importedDb = new SessionDB(join(targetRoot, ".relay", "sessions.db"), noopLogger);
    const session = importedDb.getBySessionId("sess-1");
    const managed = importedDb.getManagedByInstanceId("managed-1");
    assert.ok(session);
    assert.ok(managed);
    assert.equal(session.jsonl_path, targetClaudeTranscript);
    assert.equal(session.project_id, "project-local");
    assert.equal(session.space_id, "space-local");
    assert.equal(managed.transcript_path, targetCodexTranscript);
    assert.equal(managed.project_id, "project-local");
    assert.equal(managed.space_id, "space-local");
    assert.match(managed.runtime_payload_json, /codex-session-1\.jsonl/);
    importedDb.close();
  });

  it("exports and imports a .tgz archive", { skip: !hasTar }, async () => {
    const sourceRoot = join(tempDir, "archive-source");
    const targetRoot = join(tempDir, "archive-target");
    const archivePath = join(tempDir, "relay-export.tgz");
    const sourceClaudeDir = join(sourceRoot, ".claude");
    const targetClaudeDir = join(targetRoot, ".claude");
    const sourceTranscript = join(sourceClaudeDir, "projects", "project-a", "sess-1.jsonl");
    const targetTranscript = join(targetClaudeDir, "projects", "project-a", "sess-1.jsonl");

    mkdirSync(dirname(sourceTranscript), { recursive: true });
    writeFileSync(sourceTranscript, '{"type":"message"}\n');

    const sourceDb = new SessionDB(join(sourceRoot, ".relay", "sessions.db"), noopLogger);
    sourceDb.upsert(
      makeSessionRow({
        jsonl_path: sourceTranscript,
        space_id: null,
        project_id: null,
      }),
    );
    sourceDb.close();

    const exported = await exportRelayArchive(
      {
        dbPath: join(sourceRoot, ".relay", "sessions.db"),
        providerDirs: {
          claude: sourceClaudeDir,
          codex: join(sourceRoot, ".codex"),
        },
        logger: noopLogger,
      },
      archivePath,
    );

    assert.equal(exported.archivePath, archivePath);

    const imported = importRelayArchive(
      {
        dbPath: join(targetRoot, ".relay", "sessions.db"),
        providerDirs: {
          claude: targetClaudeDir,
          codex: join(targetRoot, ".codex"),
        },
        logger: noopLogger,
      },
      archivePath,
    );

    assert.equal(imported.transcriptFilesCopied, 1);
    assert.equal(readFileSync(targetTranscript, "utf-8"), '{"type":"message"}\n');

    const importedDb = new SessionDB(join(targetRoot, ".relay", "sessions.db"), noopLogger);
    const session = importedDb.getBySessionId("sess-1");
    assert.ok(session);
    assert.equal(session.jsonl_path, targetTranscript);
    importedDb.close();
  });
});
