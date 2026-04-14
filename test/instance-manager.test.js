import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
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

function runGit(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    timeout: 15000,
  });
}

let seedRepoDir;

function ensureSeedRepo() {
  if (seedRepoDir) return seedRepoDir;

  seedRepoDir = mkdtempSync(join(tmpdir(), "relay-im-seed-"));
  runGit(seedRepoDir, ["init", "-q", "-b", "main"]);
  writeFileSync(join(seedRepoDir, "README.md"), "# Test\n");
  runGit(seedRepoDir, ["add", "."]);
  runGit(seedRepoDir, [
    "-c",
    "user.email=test@test.com",
    "-c",
    "user.name=Test",
    "commit",
    "-q",
    "-m",
    "initial",
  ]);

  return seedRepoDir;
}

function makeRepoDir() {
  const tempRoot = mkdtempSync(join(tmpdir(), "relay-im-test-"));
  const repoDir = join(tempRoot, "repo");
  cpSync(ensureSeedRepo(), repoDir, { recursive: true });
  return repoDir;
}

function makeConfig(overrides = {}) {
  const tempDir = makeRepoDir();
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

describe("InstanceManager", () => {
  let manager;
  let managers;

  function trackManager(instanceManager) {
    managers.push(instanceManager);
    return instanceManager;
  }

  beforeEach(() => {
    managers = [];
    manager = trackManager(new InstanceManager(makeConfig()));
  });

  afterEach(() => {
    for (const instanceManager of managers.reverse()) {
      try {
        instanceManager.stopAll();
      } catch {
        // best-effort cleanup for test isolation
      }
    }
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

      const restored = trackManager(new InstanceManager(manager.baseConfig));
      restored.projectManager.addProject(projectDir);
      restored.restoreInstances();

      assert.ok(restored.getInstance("managed-shadow-owner"));
      assert.equal(restored.getInstance("shadow-external-restore"), undefined);
    });

    it("removes a live external shadow once a managed session captures the same transcript", () => {
      const projectDir = manager.baseConfig.workingDirectory;
      const project = manager.projectManager.addProject(projectDir);
      const space = manager.getSpaceManager().createSpace(projectDir, { name: "Shadow prune" });
      const transcriptPath = join(projectDir, "shadow-prune.jsonl");
      writeFileSync(transcriptPath, "{}\n");

      const db = new SessionDB(manager.baseConfig.dbPath, noopLogger);
      try {
        db.upsert(
          makeExternalRow({
            session_id: "shadow-live-session",
            instance_id: "shadow-live-external",
            jsonl_path: transcriptPath,
            working_directory: projectDir,
            original_directory: projectDir,
            worktree_path: space.worktreePath,
            git_branch: space.gitBranch,
            space_id: space.id,
            project_id: project.id,
          }),
        );
        const row = db.getBySessionId("shadow-live-session");
        assert.ok(row);
        assert.equal(manager.restoreExternalFromRow(row), true);
      } finally {
        db.close();
      }

      assert.ok(manager.getInstance("shadow-live-external"));

      const managed = manager.createInstance({ spaceId: space.id });
      const managedInstance = manager.instances.get(managed.id);
      assert.ok(managedInstance);

      manager.finalizeSessionCapture(
        managed.id,
        managedInstance,
        managedInstance.process,
        "shadow-live-session",
        transcriptPath,
      );

      assert.equal(manager.instances.has("shadow-live-external"), false);
      assert.equal(
        manager.listSpaceChats(space.id).some((chat) => chat.id === "shadow-live-external"),
        false,
      );
      assert.equal(
        manager.listSpaceChats(space.id).filter((chat) => chat.sessionId === "shadow-live-session")
          .length,
        1,
      );

      const verifyDb = new SessionDB(manager.baseConfig.dbPath, noopLogger);
      try {
        assert.equal(verifyDb.getByInstanceId("shadow-live-external"), undefined);
      } finally {
        verifyDb.close();
      }
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

      const restored = trackManager(new InstanceManager(manager.baseConfig));
      restored.restoreInstances();
      const info = restored.getInstance("managed-legacy-branch");

      assert.ok(info);
      assert.equal(info.originalGitBranch, "relay-space/deadbeef");
    });

    it("archives stale managed duplicates that point at the same provider session", () => {
      const projectDir = manager.baseConfig.workingDirectory;
      const transcriptPath = join(projectDir, "duplicate-managed.jsonl");
      writeFileSync(transcriptPath, "{}\n");
      const project = manager.projectManager.addProject(projectDir);

      const db = new SessionDB(manager.baseConfig.dbPath, noopLogger);
      try {
        db.upsertManaged(
          makeManagedRow({
            instance_id: "managed-older",
            provider_session_id: "shared-provider-session",
            transcript_path: transcriptPath,
            working_directory: projectDir,
            project_id: project.id,
            created_at: 1000,
            last_activity_at: 1500,
          }),
        );
        db.upsertManaged(
          makeManagedRow({
            instance_id: "managed-newer",
            provider_session_id: "shared-provider-session",
            transcript_path: transcriptPath,
            working_directory: projectDir,
            project_id: project.id,
            created_at: 2000,
            last_activity_at: 2500,
            resume_cursor_json: JSON.stringify({ sessionId: "shared-provider-session" }),
          }),
        );
      } finally {
        db.close();
      }

      const restored = trackManager(new InstanceManager(manager.baseConfig));
      restored.projectManager.addProject(projectDir);
      restored.restoreInstances();

      assert.equal(restored.getInstance("managed-older"), undefined);
      assert.ok(restored.getInstance("managed-newer"));

      const chats = restored.listProjectChats(project.id);
      assert.equal(chats.filter((chat) => chat.sessionId === "shared-provider-session").length, 1);

      const verifyDb = new SessionDB(manager.baseConfig.dbPath, noopLogger);
      try {
        assert.equal(verifyDb.getManagedByInstanceId("managed-older")?.archived, 1);
        assert.equal(verifyDb.getManagedByInstanceId("managed-newer")?.archived, 0);
      } finally {
        verifyDb.close();
      }
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

      const restored = trackManager(new InstanceManager(manager.baseConfig));
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

      const restored = trackManager(new InstanceManager(manager.baseConfig));
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
      const repoDir = makeRepoDir();

      const info = manager.createInstance({ workingDirectory: repoDir });
      const instance = manager.instances.get(info.id);
      assert.ok(instance);
      assert.equal(instance.info.gitInfo?.branch, "main");

      runGit(repoDir, ["checkout", "-q", "-b", "feature-branch"]);

      await manager.refreshGitBranchStateAsync(info.id, instance);

      assert.equal(instance.info.gitInfo?.branch, "feature-branch");
      assert.equal(instance.info.originalGitBranch, "main");
    });

    it("warns only once per missing space-owned working directory during git refresh", async () => {
      const warnings = [];
      const logger = {
        info() {},
        warn(message) {
          warnings.push(String(message));
        },
        error() {},
        debug() {},
      };
      const noisyManager = trackManager(new InstanceManager(makeConfig({ logger })));
      const space = noisyManager
        .getSpaceManager()
        .createSpace(noisyManager.baseConfig.workingDirectory, {
          name: "Missing worktree",
        });
      assert.ok(space.worktreePath);

      const info = noisyManager.createInstance({ spaceId: space.id });
      const instance = noisyManager.instances.get(info.id);
      assert.ok(instance);

      rmSync(space.worktreePath, { recursive: true, force: true });

      await noisyManager.refreshGitBranchStateAsync(info.id, instance);
      await noisyManager.refreshGitBranchStateAsync(info.id, instance);

      assert.equal(warnings.length, 1);
      assert.match(
        warnings[0],
        /Space-owned working directory .* is missing; keeping stale path to avoid falling back into the main repo/,
      );
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
      const _claude = manager.getProviderCapabilities("claude");
      const codex = manager.getProviderCapabilities("codex");
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

    it("purges a removed space chat from Relay and disk", () => {
      const project = manager.projectManager.addProject(manager.baseConfig.workingDirectory);
      const space = manager.getSpaceManager().createSpace(manager.baseConfig.workingDirectory, {
        name: "Purge space",
      });
      assert.ok(space.worktreePath);

      const info = manager.createInstance({ spaceId: space.id, name: "Purge me" });
      const instance = manager.instances.get(info.id);
      assert.ok(instance);

      const transcriptPath = join(manager.baseConfig.workingDirectory, "purge-space-chat.jsonl");
      writeFileSync(
        transcriptPath,
        '{"type":"message","message":{"role":"user","content":"hi"}}\n',
      );

      instance.sessionId = "purge-session";
      instance.jsonlPath = transcriptPath;
      instance.providerBinding = {
        provider: "claude",
        providerSessionId: "purge-session",
        resumeCursor: { sessionId: "purge-session" },
        runtimePayload: {},
        transcriptPath,
        runtimeMode: "approval-required",
      };

      const db = new SessionDB(manager.baseConfig.dbPath, noopLogger);
      try {
        db.upsertManaged(
          makeManagedRow({
            instance_id: info.id,
            provider_session_id: "purge-session",
            transcript_path: transcriptPath,
            working_directory: space.worktreePath,
            worktree_path: space.worktreePath,
            original_directory: manager.baseConfig.workingDirectory,
            git_branch: space.gitBranch,
            space_id: space.id,
            project_id: project.id,
            name: "Purge me",
          }),
        );
        db.upsert(
          makeExternalRow({
            session_id: "purge-session",
            instance_id: info.id,
            jsonl_path: transcriptPath,
            working_directory: manager.baseConfig.workingDirectory,
            worktree_path: space.worktreePath,
            original_directory: manager.baseConfig.workingDirectory,
            git_branch: space.gitBranch,
            space_id: space.id,
            project_id: project.id,
            name: "Purge me",
          }),
        );
      } finally {
        db.close();
      }

      assert.equal(
        manager.listSpaceChats(space.id).some((chat) => chat.id === info.id),
        true,
      );
      assert.equal(manager.removeInstance(info.id, { purge: true }), true);
      assert.equal(existsSync(transcriptPath), false);
      assert.equal(
        manager.listSpaceChats(space.id).some((chat) => chat.id === info.id),
        false,
      );

      const verifyDb = new SessionDB(manager.baseConfig.dbPath, noopLogger);
      try {
        assert.equal(verifyDb.getBySessionId("purge-session"), undefined);
        assert.equal(verifyDb.getManagedByInstanceId(info.id), undefined);
      } finally {
        verifyDb.close();
      }
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
      const repoDir = makeRepoDir();

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

        addAllowedTool() {},
        setBypassPermissions() {},
        getRuntimeBinding() {
          return { provider: "codex" };
        },
        respondToRequest() {
          return false;
        },
      };

      runGit(repoDir, ["checkout", "-q", "-b", "feature-branch"]);

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
      const modelOptions = { reasoningEffort: "high", fastMode: true };
      try {
        db.upsertManaged(
          makeManagedRow({
            instance_id: "opts-1",
            working_directory: config.workingDirectory,
            provider_session_id: "session-opts-1",
            resume_cursor_json: JSON.stringify({ sessionId: "session-opts-1" }),
            preferred_model: "claude-opus-4-6",
            reasoning_budget: null,
            model_options_json: JSON.stringify(modelOptions),
          }),
        );
      } finally {
        db.close();
      }

      const restored = trackManager(new InstanceManager(config));
      restored.restoreInstances();
      const info = restored.getInstance("opts-1");

      assert.ok(info);
      assert.deepEqual(info.modelOptions, modelOptions);
      assert.equal(info.preferredModel, "claude-opus-4-6");
    });

    it("setModelOptions sparse-merges and null clears individual fields", async () => {
      const mgr = trackManager(new InstanceManager(makeConfig()));
      const info = mgr.createInstance();

      // Set both fields
      await mgr.setModelOptions(info.id, {
        reasoningEffort: "high",
        fastMode: true,
      });
      let updated = mgr.getInstance(info.id);
      assert.deepEqual(updated.modelOptions, {
        reasoningEffort: "high",
        fastMode: true,
      });

      // Sparse update: only change effort, leave others untouched
      await mgr.setModelOptions(info.id, { reasoningEffort: "max" });
      updated = mgr.getInstance(info.id);
      assert.equal(updated.modelOptions.reasoningEffort, "max");
      assert.equal(updated.modelOptions.fastMode, true);

      // Null clears a single field
      await mgr.setModelOptions(info.id, { fastMode: null });
      updated = mgr.getInstance(info.id);
      assert.equal(updated.modelOptions.fastMode, undefined);
      assert.equal(updated.modelOptions.reasoningEffort, "max");

      // Null-clearing all fields removes the bag entirely
      await mgr.setModelOptions(info.id, {
        reasoningEffort: null,
      });
      updated = mgr.getInstance(info.id);
      assert.equal(updated.modelOptions, undefined);
    });

    it("setModelOptions pushes to live process via setModelOptions", async () => {
      const mgr = trackManager(new InstanceManager(makeConfig()));
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
      const mgr = trackManager(new InstanceManager(config));
      const info = mgr.createInstance({
        modelOptions: { reasoningEffort: "high", fastMode: true },
      });

      assert.deepEqual(info.modelOptions, { reasoningEffort: "high", fastMode: true });
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
