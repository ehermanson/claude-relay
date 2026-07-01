// TEMPORARY DIAGNOSTIC — remove after pinpointing the CI-only worktree scan failure.
// Replicates test/worktree-detection.test.js "resolves worktree cwd" setup and
// dumps every intermediate decision to stderr (visible in CI logs). Asserts
// nothing that can fail, so it never adds a red failure.
import { TEST_WORKTREE_BASE } from "./test-env.js";
import { describe, it } from "node:test";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  isRelayWorktreePath,
  isGitWorktree,
  resolveWorktreeOrigin,
  resolveAnyWorktreeOrigin,
  createWorktree,
} from "../dist/server/core/git.js";
import { InstanceManager } from "../dist/server/core/instance-manager.js";
import { resolveConfig } from "../dist/server/config.js";

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };

function runGit(cwd, args) {
  return execFileSync("git", args, { cwd, stdio: "pipe", timeout: 15000 }).toString();
}

function log(label, value) {
  console.error(`[WT-DIAG] ${label}: ${value}`);
}

describe("worktree scan diagnostic", () => {
  it("dumps the resolution chain", () => {
    try {
      log("git version", runGit(process.cwd(), ["--version"]).trim());
      log("os.tmpdir()", tmpdir());
      log("homedir()", homedir());
      log("RELAY_WORKTREE_BASE", process.env.RELAY_WORKTREE_BASE);
      log("TEST_WORKTREE_BASE", TEST_WORKTREE_BASE);
      log("TMPDIR env", process.env.TMPDIR ?? "(unset)");

      // --- build a repo (mirrors makeRepoDir) ---
      const seed = mkdtempSync(join(tmpdir(), "relay-diag-seed-"));
      runGit(seed, ["init", "-q", "-b", "main"]);
      writeFileSync(join(seed, "README.md"), "# Test\n");
      runGit(seed, ["add", "."]);
      runGit(seed, ["-c", "user.email=t@t.com", "-c", "user.name=T", "commit", "-q", "-m", "init"]);
      const root = mkdtempSync(join(tmpdir(), "relay-diag-repo-"));
      const repoDir = join(root, "repo");
      cpSync(seed, repoDir, { recursive: true });
      log("repoDir", repoDir);

      // --- create worktree (mirrors createWorktree) ---
      const wt = createWorktree(repoDir, "aabbccdd");
      log("createWorktree returned", JSON.stringify(wt));
      if (!wt) return;
      const worktreePath = wt.worktreePath;
      log("worktreePath", worktreePath);
      log(".git exists", existsSync(join(worktreePath, ".git")));
      log(".git content", JSON.stringify(readFileSync(join(worktreePath, ".git"), "utf8").trim()));

      // --- git resolution ---
      log(
        "raw --git-common-dir",
        JSON.stringify(runGit(worktreePath, ["rev-parse", "--git-common-dir"]).trim()),
      );
      try {
        log(
          "raw --path-format=absolute --git-common-dir",
          JSON.stringify(
            runGit(worktreePath, [
              "rev-parse",
              "--path-format=absolute",
              "--git-common-dir",
            ]).trim(),
          ),
        );
      } catch (e) {
        log("--path-format unsupported", String(e).slice(0, 120));
      }

      // --- relay helpers ---
      log("isRelayWorktreePath(wt)", isRelayWorktreePath(worktreePath));
      log("isGitWorktree(wt)", isGitWorktree(worktreePath));
      log("resolveWorktreeOrigin(wt)", resolveWorktreeOrigin(worktreePath));
      log("resolveAnyWorktreeOrigin(wt)", resolveAnyWorktreeOrigin(worktreePath));
      log("origin === repoDir", resolveWorktreeOrigin(worktreePath) === repoDir);

      // --- full scan (mirrors the failing test) ---
      const claudeDir = join(root, ".claude");
      const encoded = worktreePath.replace(/[^A-Za-z0-9_-]/g, "-");
      log("encoded projDir", encoded);
      const projectDir = join(claudeDir, "projects", encoded);
      mkdirSync(projectDir, { recursive: true });
      const sessionId = "00000000-0000-0000-0000-000000000001";
      writeFileSync(
        join(projectDir, `${sessionId}.jsonl`),
        JSON.stringify({ type: "system", cwd: worktreePath, timestamp: new Date().toISOString() }) +
          "\n",
      );

      const config = resolveConfig({
        password: "test",
        logger: noopLogger,
        maxProcesses: 3,
        dbPath: join(root, "sessions.db"),
        providerDirs: {
          claude: claudeDir,
          codex: join(root, ".codex"),
          gemini: join(root, ".gemini"),
        },
      });
      const manager = new InstanceManager(config);
      manager.projectManager.addProject(repoDir);
      log(
        "getProjectByDirectory(repoDir)",
        !!manager.projectManager.getProjectByDirectory(repoDir),
      );
      log(
        "getProjectByDirectory(origin)",
        !!manager.projectManager.getProjectByDirectory(
          resolveWorktreeOrigin(worktreePath) ?? "/nope",
        ),
      );
      manager.restoreAndScan();

      // --- inspect DB row created by the scan ---
      const row = manager.sessionDb.getBySessionId(sessionId);
      if (!row) {
        log("DB row", "MISSING (scan did not create it)");
      } else {
        log("DB row.type", row.type);
        log("DB row.project_id", JSON.stringify(row.project_id));
        log("DB row.archived", row.archived);
        log("DB row.working_directory", row.working_directory);
        log("DB row.original_directory", JSON.stringify(row.original_directory));
        log("DB row.worktree_path", JSON.stringify(row.worktree_path));
      }

      // --- inspect the in-memory instances Map (what listInstances reads) ---
      log("instances Map size", manager.instances.size);
      for (const inst of manager.instances.values()) {
        log(
          "  map entry",
          `projectId=${JSON.stringify(inst.info.projectId)} external=${inst.info.external} wd=${inst.info.workingDirectory}`,
        );
      }

      const instances = manager.listInstances();
      log("DISCOVERED instances (listInstances)", instances.length);
      if (instances[0]) log("instance.workingDirectory", instances[0].workingDirectory);
      manager.stopAll();
    } catch (err) {
      log("THREW", String(err));
    }
  });
});
