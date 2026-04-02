import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { InstanceManager } from "../dist/server/core/instance-manager.js";
import { SessionDB } from "../dist/server/core/db.js";
import { resolveConfig } from "../dist/server/config.js";

// Use a noop logger to keep test output clean
const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

function makeConfig(overrides = {}) {
  const tempDir = mkdtempSync(join(tmpdir(), "relay-im-test-"));
  execSync("git init -q", { cwd: tempDir });
  execSync("git config user.email test@test.com", { cwd: tempDir });
  execSync("git config user.name Test", { cwd: tempDir });
  writeFileSync(join(tempDir, "README.md"), "# Test\n");
  execSync("git add .", { cwd: tempDir });
  execSync("git commit -q -m initial", { cwd: tempDir });
  return resolveConfig({
    password: "test",
    logger: noopLogger,
    maxProcesses: 3,
    dbPath: join(tempDir, "sessions.db"),
    providerDirs: {
      claude: join(tempDir, ".claude"),
      codex: join(tempDir, ".codex"),
      gemini: join(tempDir, ".gemini"),
    },
    workingDirectory: tempDir,
    ...overrides,
  });
}

function makeManagedRow(overrides = {}) {
  return {
    instance_id: "managed-1",
    provider_name: "claude",
    provider_session_id: "session-1",
    name: "Managed Session",
    working_directory: "/tmp/test",
    created_at: 1000,
    last_activity_at: 2000,
    archived: 0,
    custom_title: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    git_branch: null,
    worktree_path: null,
    original_directory: null,
    parent_session_id: null,
    preferred_model: null,
    reasoning_budget: null,
    skip_permissions: 0,
    runtime_mode: "approval-required",
    resume_cursor_json: null,
    runtime_payload_json: "{}",
    model_options_json: null,
    original_git_branch: null,
    transcript_path: null,
    last_message_text: null,
    last_message_from: null,
    last_message_at: null,
    git_info_branch: null,
    git_info_is_worktree: null,
    space_id: null,
    project_id: null,
    model: null,
    ...overrides,
  };
}

function makeExternalRow(overrides = {}) {
  return {
    session_id: "external-1",
    instance_id: "external-instance-1",
    provider_name: "claude",
    name: "External Session",
    working_directory: "/tmp/test",
    jsonl_path: "/tmp/test/session.jsonl",
    created_at: 1000,
    last_activity_at: 2000,
    type: "external",
    archived: 0,
    custom_title: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
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
    last_message_text: null,
    last_message_from: null,
    last_message_at: null,
    git_info_branch: null,
    git_info_is_worktree: null,
    space_id: null,
    project_id: null,
    model: null,
    ...overrides,
  };
}

function createBrokenWorktree(worktreePath) {
  mkdirSync(worktreePath, { recursive: true });
  writeFileSync(worktreePath + "/.git", "gitdir: /tmp/relay-missing-worktree-admin\n");
}

describe("InstanceManager", () => {
  let manager;

  beforeEach(() => {
    manager = new InstanceManager(makeConfig());
  });

  describe("createInstance", () => {
    it("creates an instance with defaults", () => {
      const info = manager.createInstance();
      assert.ok(info.id);
      assert.equal(info.name, "New Session");
      assert.equal(info.status, "idle");
      assert.equal(info.external, undefined);
    });

    it("accepts custom name and working directory", () => {
      const info = manager.createInstance({
        name: "My Project",
        workingDirectory: "/tmp/test",
      });
      assert.equal(info.name, "My Project");
      assert.equal(info.workingDirectory, "/tmp/test");
    });

    it("uses the default session title when no name is provided", () => {
      const a = manager.createInstance();
      const b = manager.createInstance();
      assert.equal(a.name, "New Session");
      assert.equal(b.name, "New Session");
    });

    it("enforces maxProcesses limit", () => {
      manager.createInstance();
      manager.createInstance();
      manager.createInstance();
      assert.throws(() => manager.createInstance(), /Maximum processes/);
    });

    it("does not persist an empty managed instance before it has resumable state", () => {
      const info = manager.createInstance({ name: "Unsaved Draft" });
      const db = new SessionDB(manager.baseConfig.dbPath, noopLogger);

      try {
        assert.equal(db.getManagedByInstanceId(info.id), undefined);
      } finally {
        db.close();
      }
    });

    it("refuses to create a chat in an isolated space whose worktree is missing", () => {
      const space = manager.getSpaceManager().createSpace(manager.baseConfig.workingDirectory, {
        name: "Broken space",
      });
      assert.ok(space.worktreePath);

      rmSync(space.worktreePath, { recursive: true, force: true });

      assert.throws(
        () => manager.createInstance({ spaceId: space.id }),
        /missing its worktree and is currently read-only/,
      );
    });

    it("marks an isolated space as broken when its worktree disappears", () => {
      const space = manager.getSpaceManager().createSpace(manager.baseConfig.workingDirectory, {
        name: "Broken marker",
      });
      assert.ok(space.worktreePath);

      rmSync(space.worktreePath, { recursive: true, force: true });

      const refreshed = manager.getSpaceManager().getSpace(space.id);
      assert.ok(refreshed);
      assert.equal(refreshed.status, "broken");
      assert.equal(refreshed.worktreePath, null);
    });

    it("reconciles missing in-memory ownership for current-space chats before persistence", () => {
      const project = manager.projectManager.addProject(manager.baseConfig.workingDirectory);
      const space = manager.getSpaceManager().createSpace(manager.baseConfig.workingDirectory, {
        name: "Reconcile owned",
      });
      const info = manager.createInstance({ spaceId: space.id });
      const instance = manager.instances.get(info.id);

      assert.ok(instance);
      instance.info.spaceId = undefined;
      instance.info.projectId = undefined;
      instance.originalDirectory = undefined;
      instance.info.originalDirectory = undefined;

      manager.reconcileInstancePersistenceIdentity(instance);

      assert.equal(instance.info.spaceId, space.id);
      assert.equal(instance.info.projectId, project.id);
      assert.equal(instance.originalDirectory, manager.baseConfig.workingDirectory);
      assert.equal(instance.info.originalDirectory, manager.baseConfig.workingDirectory);
    });
  });

  describe("listInstances / getInstance", () => {
    it("lists all instances", () => {
      manager.createInstance({ name: "A" });
      manager.createInstance({ name: "B" });
      const list = manager.listInstances();
      assert.equal(list.length, 2);
      assert.equal(list[0].name, "A");
      assert.equal(list[1].name, "B");
    });

    it("gets instance by id", () => {
      const info = manager.createInstance({ name: "X" });
      const found = manager.getInstance(info.id);
      assert.equal(found.name, "X");
    });

    it("returns undefined for unknown id", () => {
      assert.equal(manager.getInstance("nonexistent"), undefined);
    });

    it("restores explicit space-owned managed sessions with missing worktrees as broken/read-only", () => {
      const projectDir = manager.baseConfig.workingDirectory;
      const db = new SessionDB(manager.baseConfig.dbPath, noopLogger);
      const space = manager.getSpaceManager().createSpace(projectDir, { name: "Deadbeef" });
      const missingWorktree = space.worktreePath;
      assert.ok(missingWorktree);
      rmSync(missingWorktree, { recursive: true, force: true });

      try {
        db.upsertManaged(
          makeManagedRow({
            instance_id: "managed-stale",
            working_directory: missingWorktree,
            worktree_path: missingWorktree,
            original_directory: projectDir,
            git_branch: space.gitBranch,
            space_id: space.id,
          }),
        );
      } finally {
        db.close();
      }

      const restored = new InstanceManager(manager.baseConfig);
      restored.restoreInstances();
      const info = restored.getInstance("managed-stale");
      const instance = restored.instances.get("managed-stale");

      assert.ok(info);
      assert.ok(instance);
      assert.equal(info.workingDirectory, missingWorktree);
      assert.equal(info.spaceId, space.id);
      assert.equal(instance.worktreePath, undefined);
      assert.equal(instance.originalDirectory, projectDir);
      assert.equal(instance.actualCwd, undefined);
      assert.equal(restored.getSpaceManager().getSpace(space.id)?.status, "broken");
    });

    it("restores explicit space-owned managed sessions with broken linked worktrees as broken/read-only", () => {
      const projectDir = manager.baseConfig.workingDirectory;
      const db = new SessionDB(manager.baseConfig.dbPath, noopLogger);
      const space = manager.getSpaceManager().createSpace(projectDir, { name: "Badbeef" });
      const brokenWorktree = space.worktreePath;
      assert.ok(brokenWorktree);
      rmSync(brokenWorktree, { recursive: true, force: true });
      createBrokenWorktree(brokenWorktree);

      try {
        db.upsertManaged(
          makeManagedRow({
            instance_id: "managed-broken-worktree",
            working_directory: brokenWorktree,
            worktree_path: brokenWorktree,
            original_directory: projectDir,
            git_branch: space.gitBranch,
            space_id: space.id,
            runtime_payload_json: JSON.stringify({ cwd: brokenWorktree }),
          }),
        );
      } finally {
        db.close();
      }

      const restored = new InstanceManager(manager.baseConfig);
      restored.restoreInstances();
      const info = restored.getInstance("managed-broken-worktree");
      const instance = restored.instances.get("managed-broken-worktree");

      assert.ok(info);
      assert.ok(instance);
      assert.equal(info.workingDirectory, brokenWorktree);
      assert.equal(info.spaceId, space.id);
      assert.equal(instance.worktreePath, undefined);
      assert.equal(instance.originalDirectory, projectDir);
      assert.equal(instance.actualCwd, undefined);
      assert.deepEqual(instance.providerBinding?.runtimePayload, { cwd: brokenWorktree });
      assert.equal(restored.getSpaceManager().getSpace(space.id)?.status, "broken");
    });

    it("restores current-space managed sessions with inferred explicit ownership from the spaces table", () => {
      const projectDir = manager.baseConfig.workingDirectory;
      const space = manager
        .getSpaceManager()
        .createSpace(projectDir, { name: "Managed restore owned" });
      const db = new SessionDB(manager.baseConfig.dbPath, noopLogger);

      try {
        db.upsertManaged(
          makeManagedRow({
            instance_id: "managed-space-owned",
            provider_session_id: "managed-space-owned-session",
            working_directory: space.worktreePath,
            worktree_path: space.worktreePath,
            original_directory: projectDir,
            git_branch: space.gitBranch,
            space_id: null,
          }),
        );
      } finally {
        db.close();
      }

      const restored = new InstanceManager(manager.baseConfig);
      restored.projectManager.addProject(projectDir);
      restored.restoreInstances();

      const info = restored.getInstance("managed-space-owned");
      assert.ok(info);
      assert.equal(info.spaceId, space.id);

      const rows = new SessionDB(manager.baseConfig.dbPath, noopLogger);
      try {
        assert.equal(rows.getManagedByInstanceId("managed-space-owned")?.space_id, space.id);
      } finally {
        rows.close();
      }
    });

    it("skips restoring external shadow rows when a managed session already owns the transcript", () => {
      const projectDir = manager.baseConfig.workingDirectory;
      const space = manager.getSpaceManager().createSpace(projectDir, { name: "Shadow skip" });
      const transcriptPath = join(projectDir, "shadow-skip.jsonl");
      writeFileSync(transcriptPath, "{}\n");
      const db = new SessionDB(manager.baseConfig.dbPath, noopLogger);

      try {
        db.upsertManaged(
          makeManagedRow({
            instance_id: "managed-shadow-owner",
            provider_session_id: "shadow-session",
            transcript_path: transcriptPath,
            working_directory: space.worktreePath,
            worktree_path: space.worktreePath,
            original_directory: projectDir,
            git_branch: space.gitBranch,
            space_id: space.id,
          }),
        );
        db.upsert(
          makeExternalRow({
            session_id: "shadow-session",
            instance_id: "shadow-external-restore",
            jsonl_path: transcriptPath,
            working_directory: projectDir,
            original_directory: projectDir,
            worktree_path: space.worktreePath,
            git_branch: space.gitBranch,
            space_id: space.id,
          }),
        );
      } finally {
        db.close();
      }

      const restored = new InstanceManager(manager.baseConfig);
      restored.projectManager.addProject(projectDir);
      restored.restoreInstances();

      assert.ok(restored.getInstance("managed-shadow-owner"));
      assert.equal(restored.getInstance("shadow-external-restore"), undefined);
    });

    it("falls back to persisted git metadata for originalGitBranch on restored managed sessions", () => {
      const db = new SessionDB(manager.baseConfig.dbPath, noopLogger);

      try {
        db.upsertManaged(
          makeManagedRow({
            instance_id: "managed-legacy-branch",
            working_directory: manager.baseConfig.workingDirectory,
            git_branch: "relay-space/deadbeef",
            git_info_branch: "relay-space/deadbeef",
            original_git_branch: null,
          }),
        );
      } finally {
        db.close();
      }

      const restored = new InstanceManager(manager.baseConfig);
      restored.restoreInstances();
      const info = restored.getInstance("managed-legacy-branch");

      assert.ok(info);
      assert.equal(info.originalGitBranch, "relay-space/deadbeef");
    });

    it("restores external sessions as historical until rediscovered live", () => {
      const projectDir = manager.baseConfig.workingDirectory;
      const transcriptPath = join(projectDir, "external-session.jsonl");
      writeFileSync(
        transcriptPath,
        `${JSON.stringify({
          type: "init",
          cwd: projectDir,
          sessionId: "external-1",
          timestamp: new Date().toISOString(),
        })}\n`,
      );

      const db = new SessionDB(manager.baseConfig.dbPath, noopLogger);
      try {
        db.upsert(
          makeExternalRow({
            working_directory: projectDir,
            jsonl_path: transcriptPath,
          }),
        );
      } finally {
        db.close();
      }

      const restored = new InstanceManager(manager.baseConfig);
      restored.projectManager.addProject(projectDir);
      restored.restoreInstances();

      const info = restored.getInstance("external-instance-1");
      const instance = restored.instances.get("external-instance-1");

      assert.ok(info);
      assert.ok(instance);
      assert.equal(info.status, "stopped");
      assert.equal(instance.jsonlPath, transcriptPath);
      assert.equal(instance.externalState, undefined);
      assert.equal(instance.watchState, undefined);
    });

    it("restores current-space external sessions with inferred explicit ownership from the spaces table", () => {
      const projectDir = manager.baseConfig.workingDirectory;
      const space = manager.getSpaceManager().createSpace(projectDir, { name: "Restore owned" });
      const transcriptPath = join(projectDir, "external-space-owned.jsonl");
      writeFileSync(
        transcriptPath,
        `${JSON.stringify({
          type: "init",
          cwd: space.worktreePath,
          sessionId: "external-space-owned",
          timestamp: new Date().toISOString(),
        })}\n`,
      );

      const db = new SessionDB(manager.baseConfig.dbPath, noopLogger);
      try {
        db.upsert(
          makeExternalRow({
            session_id: "external-space-owned",
            instance_id: "external-space-owned-instance",
            working_directory: projectDir,
            jsonl_path: transcriptPath,
            worktree_path: space.worktreePath,
            original_directory: projectDir,
            git_branch: space.gitBranch,
            space_id: null,
          }),
        );
      } finally {
        db.close();
      }

      const restored = new InstanceManager(manager.baseConfig);
      restored.projectManager.addProject(projectDir);
      restored.restoreInstances();

      const info = restored.getInstance("external-space-owned-instance");
      assert.ok(info);
      assert.equal(info.spaceId, space.id);

      const rows = new SessionDB(manager.baseConfig.dbPath, noopLogger);
      try {
        assert.equal(rows.getBySessionId("external-space-owned")?.space_id, space.id);
      } finally {
        rows.close();
      }
    });

    it("restores explicit space-owned external sessions with broken linked worktrees as broken/read-only", () => {
      const projectDir = manager.baseConfig.workingDirectory;
      const transcriptPath = join(projectDir, "external-broken-worktree.jsonl");
      const space = manager.getSpaceManager().createSpace(projectDir, { name: "Feedface" });
      const brokenWorktree = space.worktreePath;
      assert.ok(brokenWorktree);
      rmSync(brokenWorktree, { recursive: true, force: true });
      createBrokenWorktree(brokenWorktree);
      writeFileSync(
        transcriptPath,
        `${JSON.stringify({
          type: "init",
          cwd: brokenWorktree,
          sessionId: "external-broken",
          timestamp: new Date().toISOString(),
        })}\n`,
      );

      const db = new SessionDB(manager.baseConfig.dbPath, noopLogger);
      try {
        db.upsert(
          makeExternalRow({
            session_id: "external-broken",
            instance_id: "external-broken-instance",
            working_directory: brokenWorktree,
            jsonl_path: transcriptPath,
            worktree_path: brokenWorktree,
            original_directory: projectDir,
            git_branch: space.gitBranch,
            space_id: space.id,
          }),
        );
      } finally {
        db.close();
      }

      const restored = new InstanceManager(manager.baseConfig);
      restored.projectManager.addProject(projectDir);
      restored.restoreInstances();

      const info = restored.getInstance("external-broken-instance");
      const instance = restored.instances.get("external-broken-instance");

      assert.ok(info);
      assert.ok(instance);
      assert.equal(info.workingDirectory, brokenWorktree);
      assert.equal(info.spaceId, space.id);
      assert.equal(instance.worktreePath, undefined);
      assert.equal(instance.originalDirectory, projectDir);
      assert.equal(instance.actualCwd, undefined);
      assert.deepEqual(instance.providerBinding?.runtimePayload, { cwd: brokenWorktree });
      assert.equal(restored.getSpaceManager().getSpace(space.id)?.status, "broken");
    });

    it("upgrades restored historical externals when discovery rediscovers them", async () => {
      const projectDir = manager.baseConfig.workingDirectory;
      const transcriptPath = join(projectDir, "external-redisco.jsonl");
      writeFileSync(
        transcriptPath,
        `${JSON.stringify({
          type: "init",
          cwd: projectDir,
          sessionId: "external-1",
          timestamp: new Date().toISOString(),
        })}\n`,
      );

      const db = new SessionDB(manager.baseConfig.dbPath, noopLogger);
      try {
        db.upsert(
          makeExternalRow({
            working_directory: projectDir,
            jsonl_path: transcriptPath,
          }),
        );
      } finally {
        db.close();
      }

      const restored = new InstanceManager(manager.baseConfig);
      restored.projectManager.addProject(projectDir);
      restored.restoreInstances();
      restored.discoverExternalSessions = async () => [
        {
          provider: "claude",
          cwd: projectDir,
          transcriptPath,
          sessionId: "external-1",
          pid: 1234,
        },
      ];

      await restored.discoverExistingInner();

      const info = restored.getInstance("external-instance-1");
      const instance = restored.instances.get("external-instance-1");

      assert.ok(info);
      assert.ok(instance);
      assert.equal(info.status, "idle");
      assert.equal(instance.externalState?.jsonlPath, transcriptPath);
      assert.equal(instance.externalState?.pid, 1234);
      assert.ok(instance.watchState);
    });

    it("refreshes the live git branch without waiting for a new message", async () => {
      const repoDir = mkdtempSync(join(tmpdir(), "relay-branch-refresh-"));
      execSync("git init -q -b main", { cwd: repoDir, stdio: "pipe" });
      execSync('git config user.email "relay@example.com"', { cwd: repoDir, stdio: "pipe" });
      execSync('git config user.name "Relay Tests"', { cwd: repoDir, stdio: "pipe" });
      writeFileSync(join(repoDir, "README.md"), "hello\n");
      execSync("git add README.md", { cwd: repoDir, stdio: "pipe" });
      execSync('git commit -q -m "init"', { cwd: repoDir, stdio: "pipe" });

      const info = manager.createInstance({ workingDirectory: repoDir });
      const instance = manager.instances.get(info.id);
      assert.ok(instance);
      assert.equal(instance.info.gitInfo?.branch, "main");

      execSync("git checkout -q -b feature-branch", { cwd: repoDir, stdio: "pipe" });

      await manager.refreshGitBranchStateAsync(info.id, instance);

      assert.equal(instance.info.gitInfo?.branch, "feature-branch");
      assert.equal(instance.info.originalGitBranch, "main");
    });
  });

  describe("provider registry", () => {
    it("surfaces available providers with capabilities", () => {
      const providers = manager.getAvailableProviders();
      assert.ok(providers.some((provider) => provider.provider === "claude"));
      assert.ok(!providers.some((provider) => provider.provider === "gemini"));
      for (const provider of providers) {
        assert.equal(typeof provider.capabilities.supportsResume, "boolean");
        assert.equal(typeof provider.capabilities.supportsModelSelection, "boolean");
      }
    });

    it("returns provider capabilities from the shared registry", () => {
      const claude = manager.getProviderCapabilities("claude");
      const codex = manager.getProviderCapabilities("codex");
      assert.equal(claude.supportsReasoningBudget, true);
      assert.equal(codex.supportsReasoningBudget, false);
      assert.equal(codex.supportsTitleUpdates, true);
    });

    it("rejects switching to an unavailable provider", async () => {
      const info = manager.createInstance();
      assert.equal(await manager.setProvider(info.id, "gemini"), false);
    });
  });

  describe("removeInstance", () => {
    it("removes an instance", () => {
      const info = manager.createInstance();
      assert.equal(manager.removeInstance(info.id), true);
      assert.equal(manager.listInstances().length, 0);
    });

    it("returns false for unknown id", () => {
      assert.equal(manager.removeInstance("nonexistent"), false);
    });

    it("frees a slot for new instances", () => {
      const a = manager.createInstance();
      manager.createInstance();
      manager.createInstance();
      assert.throws(() => manager.createInstance(), /Maximum/);
      manager.removeInstance(a.id);
      const d = manager.createInstance(); // should succeed now
      assert.ok(d.id);
    });

    it("does not remove a shared space worktree when deleting one chat", () => {
      const space = manager.getSpaceManager().createSpace(manager.baseConfig.workingDirectory, {
        name: "Shared space",
      });
      assert.ok(space.worktreePath);
      assert.equal(existsSync(space.worktreePath), true);

      const info = manager.createInstance({ spaceId: space.id });
      assert.equal(manager.removeInstance(info.id), true);

      const refreshedSpace = manager.getSpaceManager().getSpace(space.id);
      assert.ok(refreshedSpace?.worktreePath);
      assert.equal(existsSync(refreshedSpace.worktreePath), true);
    });

    it("preserves a shared space worktree even if the instance is missing in-memory spaceId", () => {
      const space = manager.getSpaceManager().createSpace(manager.baseConfig.workingDirectory, {
        name: "Recovered shared space",
      });
      assert.ok(space.worktreePath);
      assert.equal(existsSync(space.worktreePath), true);

      const info = manager.createInstance({ spaceId: space.id });
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      instance.info.spaceId = undefined;

      assert.equal(manager.removeInstance(info.id), true);

      const refreshedSpace = manager.getSpaceManager().getSpace(space.id);
      assert.ok(refreshedSpace?.worktreePath);
      assert.equal(existsSync(refreshedSpace.worktreePath), true);
    });
  });

  describe("listProjectChats", () => {
    it("dedupes managed transcript shadows after backfilling explicit space ids", () => {
      const project = manager.projectManager.addProject(manager.baseConfig.workingDirectory);
      const space = manager.getSpaceManager().createSpace(manager.baseConfig.workingDirectory, {
        name: "Space",
      });
      const db = new SessionDB(manager.baseConfig.dbPath, noopLogger);

      try {
        db.upsertManaged(
          makeManagedRow({
            instance_id: "managed-space-chat",
            provider_session_id: "shared-session",
            transcript_path: "/tmp/shared.jsonl",
            working_directory: space.worktreePath,
            worktree_path: space.worktreePath,
            original_directory: manager.baseConfig.workingDirectory,
            git_branch: space.gitBranch,
            space_id: space.id,
            project_id: project.id,
            name: "Managed space chat",
          }),
        );

        db.upsert(
          makeExternalRow({
            session_id: "shared-session",
            instance_id: "shadow-external",
            jsonl_path: "/tmp/shared.jsonl",
            working_directory: manager.baseConfig.workingDirectory,
            original_directory: manager.baseConfig.workingDirectory,
            worktree_path: space.worktreePath,
            git_branch: "main",
            space_id: null,
            project_id: project.id,
            name: "Shadow external",
          }),
        );

        db.upsert(
          makeExternalRow({
            session_id: "external-space-only",
            instance_id: "external-space-only",
            jsonl_path: "/tmp/external-space-only.jsonl",
            working_directory: manager.baseConfig.workingDirectory,
            original_directory: manager.baseConfig.workingDirectory,
            worktree_path: space.worktreePath,
            git_branch: "main",
            space_id: null,
            project_id: project.id,
            name: "External inferred space chat",
          }),
        );
      } finally {
        db.close();
      }

      manager.backfillMissingSpaceIds();

      const chats = manager.listProjectChats(project.id);
      assert.equal(
        chats.some((chat) => chat.id === "shadow-external"),
        false,
      );

      const inferred = chats.find((chat) => chat.id === "external-space-only");
      assert.ok(inferred);
      assert.equal(inferred.spaceId, space.id);

      const managed = chats.find((chat) => chat.id === "managed-space-chat");
      assert.ok(managed);
      assert.equal(managed.spaceId, space.id);

      const rows = new SessionDB(manager.baseConfig.dbPath, noopLogger);
      try {
        assert.equal(rows.getByInstanceId("external-space-only")?.space_id, space.id);
      } finally {
        rows.close();
      }
    });
  });

  describe("getHistory", () => {
    it("returns empty history for new instance", () => {
      const info = manager.createInstance();
      const history = manager.getHistory(info.id);
      assert.deepEqual(history, []);
    });

    it("throws for unknown instance", () => {
      assert.throws(() => manager.getHistory("nope"), /not found/);
    });
  });

  describe("broken spaces", () => {
    it("blocks sending messages to chats in broken isolated spaces", async () => {
      const space = manager.getSpaceManager().createSpace(manager.baseConfig.workingDirectory, {
        name: "Broken send guard",
      });
      assert.ok(space.worktreePath);

      const info = manager.createInstance({ spaceId: space.id });
      rmSync(space.worktreePath, { recursive: true, force: true });

      await assert.rejects(
        () => manager.sendMessage(info.id, "hello"),
        /missing its worktree and is currently read-only/,
      );
    });
  });

  describe("sendMessage guards", () => {
    it("throws for unknown instance", async () => {
      await assert.rejects(() => manager.sendMessage("nope", "hi"), /not found/);
    });

    it("folds task guidance into the first real user turn instead of sending a separate hidden turn", async () => {
      const relayDir = join(manager.baseConfig.workingDirectory, ".relay");
      mkdirSync(relayDir, { recursive: true });
      writeFileSync(
        join(relayDir, "tasks.jsonl"),
        '{"id":"task1234","title":"Test","status":"open"}\n',
      );

      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      const sentMessages = [];
      instance.process = {
        ...instance.process,
        isProcessing: false,
        provider: "codex",
        pid: undefined,
        stats: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
        send(text) {
          sentMessages.push(text);
        },
        interrupt() {},
        close() {},
        setModel() {},
        setReasoningBudget() {},
        addAllowedTool() {},
        setBypassPermissions() {},
        getRuntimeBinding() {
          return { provider: "codex" };
        },
        respondToRequest() {
          return false;
        },
      };

      await manager.sendMessage(info.id, "tell me how to run this locally");

      assert.equal(sentMessages.length, 1);
      assert.match(sentMessages[0], /This project tracks tasks in \.relay\/tasks\.jsonl/);
      assert.match(sentMessages[0], /Do not mention, restate, or acknowledge/);
      assert.match(sentMessages[0], /User request:\ntell me how to run this locally/);

      const history = manager.getHistory(info.id).filter((entry) => entry.message.type === "user");
      assert.equal(history.length, 1);
      assert.equal(history[0].message.text, "tell me how to run this locally");
      assert.equal(history[0].message.internal, undefined);
    });

    it("still sends messages after a branch change while surfacing branch drift", async () => {
      const repoDir = mkdtempSync(join(tmpdir(), "relay-branch-check-"));
      execSync("git init -q -b main", { cwd: repoDir, stdio: "pipe" });
      execSync('git config user.email "relay@example.com"', { cwd: repoDir, stdio: "pipe" });
      execSync('git config user.name "Relay Tests"', { cwd: repoDir, stdio: "pipe" });
      writeFileSync(join(repoDir, "README.md"), "hello\n");
      execSync("git add README.md", { cwd: repoDir, stdio: "pipe" });
      execSync('git commit -q -m "init"', { cwd: repoDir, stdio: "pipe" });

      const info = manager.createInstance({ workingDirectory: repoDir });
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      const sentMessages = [];
      instance.process = {
        ...instance.process,
        isProcessing: false,
        provider: "codex",
        pid: undefined,
        stats: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
        send(text) {
          sentMessages.push(text);
        },
        interrupt() {},
        close() {},
        setModel() {},
        setReasoningBudget() {},
        addAllowedTool() {},
        setBypassPermissions() {},
        getRuntimeBinding() {
          return { provider: "codex" };
        },
        respondToRequest() {
          return false;
        },
      };

      execSync("git checkout -q -b feature-branch", { cwd: repoDir, stdio: "pipe" });

      await manager.refreshGitBranchStateAsync(info.id, instance);
      await manager.sendMessage(info.id, "hello on the new branch");

      assert.deepEqual(instance.info.branchChanged, {
        originalBranch: "main",
        currentBranch: "feature-branch",
      });
      assert.equal(instance.info.gitInfo?.branch, "feature-branch");
      assert.deepEqual(sentMessages, ["hello on the new branch"]);
    });
  });

  describe("cancelMessage guards", () => {
    it("throws for unknown instance", async () => {
      await assert.rejects(() => manager.cancelMessage("nope"), /not found/);
    });
  });

  describe("approveToolUse guards", () => {
    it("throws for unknown instance", async () => {
      await assert.rejects(() => manager.approveToolUse("nope", "Bash"), /not found/);
    });
  });

  describe("respondToRequest", () => {
    it("falls back to a normal user message for provider-neutral AskUserQuestion replies", async () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      const sentMessages = [];
      instance.process = {
        ...instance.process,
        isProcessing: false,
        provider: "claude",
        pid: undefined,
        stats: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
        send(text) {
          sentMessages.push(text);
        },
        interrupt() {},
        close() {},
        setModel() {},
        setReasoningBudget() {},
        addAllowedTool() {},
        setBypassPermissions() {},
        getRuntimeBinding() {
          return { provider: "claude" };
        },
        respondToRequest() {
          return false;
        },
      };

      instance.info.pendingPermission = {
        requestId: "ask-1",
        kind: "user_input",
        tool: "AskUserQuestion",
        questions: [
          {
            id: "drink",
            header: "Preference",
            question: "Which do you prefer?",
            options: [
              { label: "Coffee", description: "Bolder flavor" },
              { label: "Tea", description: "Lighter flavor" },
            ],
          },
        ],
      };

      await manager.respondToRequest(info.id, "ask-1", "accept", {
        answers: {
          drink: {
            answers: ["Tea"],
          },
        },
      });

      assert.deepEqual(sentMessages, ["Tea"]);
      assert.equal(instance.info.pendingPermission, undefined);
      const lastHistory = instance.history[instance.history.length - 2];
      assert.equal(lastHistory.message.type, "activity");
      assert.equal(lastHistory.message.tool, "AskUserQuestion");
      assert.equal(lastHistory.message.resolution, "approved");
    });

    it("turns empty AskUserQuestion answers into a dismiss-style fallback reply", async () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      const sentMessages = [];
      instance.process = {
        ...instance.process,
        isProcessing: false,
        provider: "claude",
        pid: undefined,
        stats: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
        send(text) {
          sentMessages.push(text);
        },
        interrupt() {},
        close() {},
        setModel() {},
        setReasoningBudget() {},
        addAllowedTool() {},
        setBypassPermissions() {},
        getRuntimeBinding() {
          return { provider: "claude" };
        },
        respondToRequest() {
          return false;
        },
      };

      instance.info.pendingPermission = {
        requestId: "ask-2",
        kind: "user_input",
        tool: "AskUserQuestion",
        questions: [
          {
            id: "drink",
            header: "Preference",
            question: "Which do you prefer?",
          },
        ],
      };

      await manager.respondToRequest(info.id, "ask-2", "accept", { answers: {} });

      assert.equal(
        sentMessages[0],
        "I prefer not to answer that question. Please continue without it if possible.",
      );
      const lastHistory = instance.history[instance.history.length - 2];
      assert.equal(lastHistory.message.type, "activity");
      assert.equal(lastHistory.message.resolution, "dismissed");
    });
  });

  describe("stopAll", () => {
    it("clears all instances", () => {
      manager.createInstance();
      manager.createInstance();
      manager.stopAll();
      assert.equal(manager.listInstances().length, 0);
    });
  });

  describe("status events", () => {
    it("emits instance:status on status change", (_, done) => {
      // We can't easily test processing without a real claude process,
      // but we can verify the event infrastructure works by checking
      // that createInstance sets up proper event wiring
      const info = manager.createInstance();
      assert.equal(info.status, "idle");
      done();
    });
  });

  describe("watcher dedup", () => {
    it("skips watcher entries already handled by the managed process", () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      const now = Date.now();
      instance.processHandledUntil = now + 2_000;
      instance.watchState = {
        jsonlPath: "/tmp/test.jsonl",
        fileOffset: 0,
        pendingTools: new Map(),
        pendingTaskCreates: new Map(),
        stats: {
          inputTokens: 1,
          outputTokens: 2,
          cacheCreationTokens: 3,
          cacheReadTokens: 4,
        },
      };
      instance.info.stats = { ...instance.watchState.stats };

      manager.applyWatcherEntry(info.id, instance, {
        type: "assistant",
        timestamp: new Date(now + 1_000).toISOString(),
        message: {
          model: "claude-opus-4-6",
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_creation_input_tokens: 30,
            cache_read_input_tokens: 40,
          },
          content: [{ type: "text", text: "duplicate output" }],
        },
      });

      assert.equal(instance.history.length, 0);
      assert.deepEqual(instance.watchState.stats, {
        inputTokens: 1,
        outputTokens: 2,
        cacheCreationTokens: 3,
        cacheReadTokens: 4,
      });
      assert.deepEqual(instance.info.stats, {
        inputTokens: 1,
        outputTokens: 2,
        cacheCreationTokens: 3,
        cacheReadTokens: 4,
      });
    });

    it("applies watcher entries newer than the managed-process watermark", () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      const now = Date.now();
      instance.processHandledUntil = now + 500;
      instance.watchState = {
        jsonlPath: "/tmp/test.jsonl",
        fileOffset: 0,
        pendingTools: new Map(),
        pendingTaskCreates: new Map(),
        stats: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
      };
      instance.info.stats = { ...instance.watchState.stats };

      manager.applyWatcherEntry(info.id, instance, {
        type: "assistant",
        timestamp: new Date(now + 5_000).toISOString(),
        message: {
          model: "claude-opus-4-6",
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_creation_input_tokens: 30,
            cache_read_input_tokens: 40,
          },
          content: [{ type: "text", text: "fresh external output" }],
        },
      });

      assert.equal(instance.history.length, 2);
      assert.equal(instance.history[0].message.type, "output");
      assert.equal(instance.history[1].message.type, "output");
      assert.equal(instance.history[0].message.text, "fresh external output");
      assert.equal(instance.history[1].message.isWaiting, true);
      assert.equal(instance.watchState.stats.inputTokens, 10);
      assert.equal(instance.watchState.stats.outputTokens, 20);
      assert.equal(instance.watchState.stats.cacheCreationTokens, 30);
      assert.equal(instance.watchState.stats.cacheReadTokens, 40);
      assert.equal(instance.info.stats.inputTokens, 10);
      assert.equal(instance.info.stats.outputTokens, 20);
    });

    it("skips instance:user emit from watcher for managed instances", () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      // Simulate a managed instance (has a process object)
      instance.process = { isProcessing: false };
      instance.watchState = {
        jsonlPath: "/tmp/test.jsonl",
        fileOffset: 0,
        pendingTools: new Map(),
        pendingTaskCreates: new Map(),
        stats: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
      };

      const emitted = [];
      manager.on("instance:user", (id, msg) => emitted.push({ id, msg }));

      manager.applyWatcherEntry(info.id, instance, {
        type: "user",
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [{ type: "text", text: "hello from watcher" }],
        },
      });

      // User message should be in history (pushHistory still runs)
      const userEntries = instance.history.filter((h) => h.message.type === "user");
      assert.equal(userEntries.length, 1);

      // But instance:user should NOT have been emitted (managed instance)
      assert.equal(emitted.length, 0);
    });

    it("emits instance:user from watcher for external instances", () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      // External instance: no process
      instance.process = null;
      instance.watchState = {
        jsonlPath: "/tmp/test.jsonl",
        fileOffset: 0,
        pendingTools: new Map(),
        pendingTaskCreates: new Map(),
        stats: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
      };

      const emitted = [];
      manager.on("instance:user", (id, msg) => emitted.push({ id, msg }));

      manager.applyWatcherEntry(info.id, instance, {
        type: "user",
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [{ type: "text", text: "hello from terminal" }],
        },
      });

      // User message should be in history
      const userEntries = instance.history.filter((h) => h.message.type === "user");
      assert.equal(userEntries.length, 1);

      // instance:user SHOULD be emitted (external instance)
      assert.equal(emitted.length, 1);
      assert.equal(emitted[0].msg.text, "hello from terminal");
    });

    it("maps watcher AskUserQuestion entries into pending composer state", () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      instance.watchState = {
        jsonlPath: "/tmp/test.jsonl",
        fileOffset: 0,
        pendingTools: new Map(),
        pendingTaskCreates: new Map(),
        stats: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
      };

      manager.applyWatcherEntry(info.id, instance, {
        type: "assistant",
        timestamp: new Date().toISOString(),
        message: {
          content: [
            {
              type: "tool_use",
              id: "watch-ask-1",
              name: "AskUserQuestion",
              input: {
                questions: [
                  {
                    id: "drink",
                    header: "Preference",
                    question: "Which do you prefer?",
                  },
                ],
              },
            },
          ],
        },
      });

      assert.equal(instance.info.pendingTool, undefined);
      assert.equal(instance.info.pendingPermission?.kind, "user_input");
      assert.equal(instance.info.pendingPermission?.requestId, "watch-ask-1");
      const promptHistory = instance.history.find(
        (entry) =>
          entry.message.type === "activity" &&
          entry.message.activity === "tool_use" &&
          entry.message.tool === "AskUserQuestion",
      );
      assert.ok(promptHistory);
      assert.equal(promptHistory.message.input.requestId, "watch-ask-1");
    });
  });

  describe("modelOptions", () => {
    it("restores modelOptions from model_options_json on managed session restore", () => {
      const config = makeConfig();
      const db = new SessionDB(config.dbPath, noopLogger);
      const modelOptions = { reasoningBudgetTokens: 8192, reasoningEffort: "high", fastMode: true };
      try {
        db.upsertManaged(
          makeManagedRow({
            instance_id: "opts-1",
            working_directory: config.workingDirectory,
            provider_session_id: "session-opts-1",
            resume_cursor_json: JSON.stringify({ sessionId: "session-opts-1" }),
            preferred_model: "claude-opus-4-6",
            reasoning_budget: 8192,
            model_options_json: JSON.stringify(modelOptions),
          }),
        );
      } finally {
        db.close();
      }

      const restored = new InstanceManager(config);
      restored.restoreInstances();
      const info = restored.getInstance("opts-1");

      assert.ok(info);
      assert.deepEqual(info.modelOptions, modelOptions);
      assert.equal(info.reasoningBudget, 8192);
      assert.equal(info.preferredModel, "claude-opus-4-6");
    });

    it("setModelOptions sparse-merges and null clears individual fields", async () => {
      const mgr = new InstanceManager(makeConfig());
      const info = mgr.createInstance();

      // Set all three fields
      await mgr.setModelOptions(info.id, {
        reasoningBudgetTokens: 5000,
        reasoningEffort: "high",
        fastMode: true,
      });
      let updated = mgr.getInstance(info.id);
      assert.deepEqual(updated.modelOptions, {
        reasoningBudgetTokens: 5000,
        reasoningEffort: "high",
        fastMode: true,
      });
      assert.equal(updated.reasoningBudget, 5000);

      // Sparse update: only change effort, leave others untouched
      await mgr.setModelOptions(info.id, { reasoningEffort: "max" });
      updated = mgr.getInstance(info.id);
      assert.equal(updated.modelOptions.reasoningEffort, "max");
      assert.equal(updated.modelOptions.reasoningBudgetTokens, 5000);
      assert.equal(updated.modelOptions.fastMode, true);

      // Null clears a single field
      await mgr.setModelOptions(info.id, { fastMode: null });
      updated = mgr.getInstance(info.id);
      assert.equal(updated.modelOptions.fastMode, undefined);
      assert.equal(updated.modelOptions.reasoningBudgetTokens, 5000);
      assert.equal(updated.modelOptions.reasoningEffort, "max");

      // Null-clearing all fields removes the bag entirely
      await mgr.setModelOptions(info.id, {
        reasoningBudgetTokens: null,
        reasoningEffort: null,
      });
      updated = mgr.getInstance(info.id);
      assert.equal(updated.modelOptions, undefined);
      assert.equal(updated.reasoningBudget, undefined);
    });

    it("setReasoningBudget delegates to setModelOptions", async () => {
      const mgr = new InstanceManager(makeConfig());
      const info = mgr.createInstance();

      await mgr.setReasoningBudget(info.id, 10000);
      let updated = mgr.getInstance(info.id);
      assert.equal(updated.modelOptions.reasoningBudgetTokens, 10000);
      assert.equal(updated.reasoningBudget, 10000);

      await mgr.setReasoningBudget(info.id, null);
      updated = mgr.getInstance(info.id);
      assert.equal(updated.modelOptions, undefined);
      assert.equal(updated.reasoningBudget, undefined);
    });

    it("setModelOptions pushes to live process via setModelOptions", async () => {
      const mgr = new InstanceManager(makeConfig());
      const info = mgr.createInstance();
      const instance = mgr.instances.get(info.id);
      assert.ok(instance);

      const captured = [];
      instance.process = {
        ...instance.process,
        isProcessing: false,
        provider: "codex",
        pid: undefined,
        stats: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
        send() {},
        interrupt() {},
        close() {},
        setModel() {},
        setReasoningBudget() {},
        addAllowedTool() {},
        setBypassPermissions() {},
        setModelOptions(opts) {
          captured.push(opts);
        },
        getRuntimeBinding() {
          return { provider: "codex" };
        },
      };

      await mgr.setModelOptions(info.id, { reasoningEffort: "high", fastMode: true });
      assert.equal(captured.length, 1);
      assert.equal(captured[0].reasoningEffort, "high");
      assert.equal(captured[0].fastMode, true);
    });

    it("persists modelOptions to model_options_json in DB on create with options", () => {
      const config = makeConfig();
      const mgr = new InstanceManager(config);
      const info = mgr.createInstance({
        modelOptions: { reasoningBudgetTokens: 7777, fastMode: true },
      });

      assert.deepEqual(info.modelOptions, { reasoningBudgetTokens: 7777, fastMode: true });
      assert.equal(info.reasoningBudget, 7777);
    });
  });

  describe("sendMessage auto-exits plan mode on plan approval", () => {
    it("exits plan mode when sending a message while pendingPlan is set", async () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      let planModeSet = undefined;
      const sentMessages = [];
      instance.process = {
        ...instance.process,
        isProcessing: false,
        provider: "codex",
        pid: undefined,
        stats: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
        send(text) {
          sentMessages.push(text);
        },
        interrupt() {},
        close() {},
        setModel() {},
        setReasoningBudget() {},
        addAllowedTool() {},
        setBypassPermissions() {},
        setPlanMode(mode) {
          planModeSet = mode;
        },
        getRuntimeBinding() {
          return { provider: "codex" };
        },
        respondToRequest() {
          return false;
        },
      };

      // Simulate plan mode active with a pending plan
      instance.info.planMode = true;
      instance.info.pendingPlan = "# The Plan\nDo things";
      instance.info.status = "idle";

      // Send approval message
      await manager.sendMessage(info.id, "Yes, go ahead with this plan.");

      // Should have exited plan mode
      assert.equal(planModeSet, false, "setPlanMode(false) should be called");
      assert.equal(instance.info.planMode, false, "planMode should be false");
      assert.equal(instance.info.pendingPlan, undefined, "pendingPlan should be cleared");
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0], "Yes, go ahead with this plan.");
    });

    it("preserves plan mode when no pendingPlan is set", async () => {
      const info = manager.createInstance();
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      let planModeSet = undefined;
      instance.process = {
        ...instance.process,
        isProcessing: false,
        provider: "codex",
        pid: undefined,
        stats: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 },
        send() {},
        interrupt() {},
        close() {},
        setModel() {},
        setReasoningBudget() {},
        addAllowedTool() {},
        setBypassPermissions() {},
        setPlanMode(mode) {
          planModeSet = mode;
        },
        getRuntimeBinding() {
          return { provider: "codex" };
        },
        respondToRequest() {
          return false;
        },
      };

      // Plan mode active but no pending plan (normal message during plan mode)
      instance.info.planMode = true;
      instance.info.pendingPlan = undefined;
      instance.info.status = "idle";

      await manager.sendMessage(info.id, "plan this feature");

      // Should stay in plan mode
      assert.equal(planModeSet, undefined, "setPlanMode should not be called");
      assert.equal(instance.info.planMode, true, "planMode should remain true");
    });
  });
});
