import { PassThrough } from "node:stream";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createProjectRoutes } from "../dist/server/http/routes/projects.js";
import { AuthManager } from "../dist/server/auth.js";
import { InstanceManager } from "../dist/core/instance-manager.js";
import { resolveConfig } from "../dist/server/config.js";

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
};

function createMockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk = "") {
      this.body += chunk;
    },
  };
}

describe("project init route", () => {
  let auth;
  let manager;
  let tempDir;
  let route;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "relay-project-route-"));
    const config = resolveConfig({
      password: "testpass",
      logger: noopLogger,
      maxProcesses: 5,
      serveUI: false,
      rateLimitMax: 10,
      rateLimitWindow: 60_000,
      sessionFile: join(tempDir, "sessions.json"),
      dbPath: join(tempDir, "sessions.db"),
      claudeDir: join(tempDir, ".claude"),
      codexDir: join(tempDir, ".codex"),
    });
    auth = new AuthManager(config);
    manager = new InstanceManager(config);
    route = createProjectRoutes({
      config,
      auth,
      instanceManager: manager,
      startedAt: Date.now(),
      packageVersion: "test",
      uiDistDir: tempDir,
      indexHtmlPath: join(tempDir, "index.html"),
      getProviderModels: async () => [],
      getProviderCapabilities: () => ({
        supportsResume: true,
        supportsTranscriptReplay: true,
        supportsManagedSessions: true,
        supportsImages: true,
        supportsPlanMode: true,
        supportsReasoningEffort: true,
        supportsModelDiscovery: true,
      }),
      getAvailableProviders: () => [],
      getOpenTargets: async () => ({ path: "", preferredTargetId: null, targets: [] }),
      openNativePath: async () => {},
      getGitRepos: async () => [],
    }).find(
      (candidate) => candidate.method === "POST" && candidate.pattern.test("/api/projects/init"),
    );
  });

  afterEach(() => {
    manager.stopAll();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("requires authentication", async () => {
    assert.ok(route, "route should exist");
    const req = new PassThrough();
    const res = createMockResponse();
    await route.handler(
      {
        req,
        res,
        method: "POST",
        parsedUrl: new URL("http://localhost/api/projects/init"),
        pathname: "/api/projects/init",
        session: null,
        isAuthenticated: false,
      },
      "/api/projects/init".match(route.pattern),
    );

    assert.equal(res.statusCode, 401);
    assert.deepEqual(JSON.parse(res.body), { error: "Unauthorized" });
  });

  it("creates and registers a new git project", async () => {
    assert.ok(route, "route should exist");
    const session = auth.createSession();
    const req = new PassThrough();
    const res = createMockResponse();
    const handlerPromise = route.handler(
      {
        req,
        res,
        method: "POST",
        parsedUrl: new URL("http://localhost/api/projects/init"),
        pathname: "/api/projects/init",
        session,
        isAuthenticated: true,
      },
      "/api/projects/init".match(route.pattern),
    );
    req.end(JSON.stringify({ parentDirectory: tempDir, name: "new-project" }));
    await handlerPromise;

    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 201);
    assert.equal(body.name, "new-project");
    assert.equal(realpathSync(body.directory), realpathSync(join(tempDir, "new-project")));
    assert.equal(
      execSync("git rev-parse --is-inside-work-tree", {
        cwd: join(tempDir, "new-project"),
        stdio: "pipe",
      })
        .toString()
        .trim(),
      "true",
    );
    assert.ok(
      execSync("git rev-parse --verify HEAD", {
        cwd: join(tempDir, "new-project"),
        stdio: "pipe",
      })
        .toString()
        .trim().length > 0,
    );
    assert.equal(
      realpathSync(manager.projectManager.getProject(body.id)?.directory),
      realpathSync(join(tempDir, "new-project")),
    );
  });
});
