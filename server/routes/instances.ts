import type { Hono } from "hono";
import {
  commitAll,
  getCommitsAhead,
  getDefaultBranch,
  getWorktreeStatus,
  gitFetch,
  gitPull,
  gitPush,
  isWorktreeDirty,
} from "#core/git.js";
import type { ProviderKind, ProviderModelOptions, ProviderRuntimeMode } from "#core/types.js";
import { readJsonBody } from "#server/hono-utils.js";
import type { AppEnv, HttpDeps } from "#server/route-types.js";

export function registerInstanceRoutes(app: Hono<AppEnv>, deps: HttpDeps): void {
  const { instanceManager } = deps;

  app.get("/api/instances", (c) => {
    return c.json(instanceManager.listInstances());
  });

  app.post("/api/instances", async (c) => {
    try {
      const body = await readJsonBody<{
        provider?: ProviderKind;
        name?: string;
        workingDirectory?: string;
        runtimeMode?: ProviderRuntimeMode;
        resumeSessionId?: string;
        model?: string;
        spaceId?: string;
        modelOptions?: ProviderModelOptions;
        parentSessionId?: string;
        review?: import("#core/types.js").ReviewSessionInfo;
      }>(c);
      const info = instanceManager.createInstance({
        provider: body.provider,
        name: body.name,
        workingDirectory: body.workingDirectory,
        runtimeMode: body.runtimeMode,
        resumeSessionId: body.resumeSessionId,
        model: body.model,
        spaceId: body.spaceId,
        modelOptions: body.modelOptions,
        parentSessionId: body.parentSessionId,
        review: body.review,
      });
      return c.json(info, 201);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to create instance" },
        400,
      );
    }
  });

  app.get("/api/instances/:id/summary", (c) => {
    const summary = instanceManager.getChatSummary(c.req.param("id"));
    if (!summary) {
      return c.json({ error: "Instance not found" }, 404);
    }
    return c.json(summary);
  });

  app.delete("/api/instances/:id", (c) => {
    const removed = instanceManager.removeInstance(c.req.param("id"));
    if (removed) {
      return c.json({ success: true });
    }
    return c.json({ error: "Instance not found" }, 404);
  });

  app.post("/api/instances/:id/merge", (c) => {
    try {
      const { targetBranch } = instanceManager.mergeInstance(c.req.param("id"));
      return c.json({ success: true, targetBranch });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to merge" }, 400);
    }
  });

  app.get("/api/instances/:id/history", (c) => {
    try {
      return c.json(instanceManager.getHistory(c.req.param("id")));
    } catch {
      return c.json({ error: "Instance not found" }, 404);
    }
  });

  app.get("/api/instances/:id/diff", (c) => {
    const diff = instanceManager.getInstanceDiff(c.req.param("id"), c.req.query("path"));
    if (diff === null) {
      return c.json({ error: "Instance not found or not a git repo" }, 404);
    }
    return c.json({ diff });
  });

  app.post("/api/instances/:id/git/commit", async (c) => {
    const instance = instanceManager.getInstance(c.req.param("id"));
    if (!instance) {
      return c.json({ error: "Instance not found" }, 404);
    }
    try {
      const body = await readJsonBody<{ message?: string }>(c);
      const dir = instance.workingDirectory;
      if (!isWorktreeDirty(dir)) {
        return c.json({ success: false, error: "Nothing to commit — working tree is clean" }, 400);
      }
      const result = commitAll(dir, body.message || "Commit via Relay");
      return c.json(result, result.success ? 200 : 400);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to commit" }, 400);
    }
  });

  app.get("/api/instances/:id/git/status", (c) => {
    const instance = instanceManager.getInstance(c.req.param("id"));
    if (!instance) {
      return c.json({ error: "Instance not found" }, 404);
    }
    try {
      const status = getWorktreeStatus(instance.workingDirectory);

      // `reviewableDiff` is broader than `dirty`: for a space chat, committed
      // work on the space branch (not yet in the base branch) also counts as
      // "reviewable", so suggestions like "Review Changes" stay relevant after
      // the agent has already committed its work.
      let reviewableDiff = status.dirty;
      if (!reviewableDiff) {
        const spaceId = instance.spaceId;
        if (spaceId) {
          const space = instanceManager.getSpaceManager().getSpace(spaceId);
          const baseRef =
            space?.targetBranch || getDefaultBranch(instance.workingDirectory) || null;
          if (baseRef && baseRef !== space?.gitBranch) {
            reviewableDiff = getCommitsAhead(instance.workingDirectory, baseRef) > 0;
          }
        }
      }

      return c.json({ ...status, reviewableDiff });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to read git status" },
        400,
      );
    }
  });

  app.post("/api/instances/:id/git/push", async (c) => {
    const instance = instanceManager.getInstance(c.req.param("id"));
    if (!instance) {
      return c.json({ error: "Instance not found" }, 404);
    }
    try {
      const body = await readJsonBody<{
        branch?: string;
        setUpstream?: boolean;
        commitMessage?: string;
      }>(c);
      const dirty = isWorktreeDirty(instance.workingDirectory);
      const commitMessage = body.commitMessage?.trim();
      if (dirty && !commitMessage) {
        return c.json(
          { success: false, error: "Commit or stash uncommitted changes before pushing" },
          400,
        );
      }
      if (dirty && commitMessage) {
        const commitResult = commitAll(instance.workingDirectory, commitMessage);
        if (!commitResult.success) {
          return c.json(commitResult, 400);
        }
      }
      const result = await gitPush(
        instance.workingDirectory,
        body.branch || instance.gitInfo?.branch || instance.gitBranch,
        body.setUpstream,
      );
      return c.json(result, result.success ? 200 : 400);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to push" }, 400);
    }
  });

  app.post("/api/instances/:id/git/fetch", async (c) => {
    const instance = instanceManager.getInstance(c.req.param("id"));
    if (!instance) {
      return c.json({ error: "Instance not found" }, 404);
    }
    const result = await gitFetch(instance.workingDirectory);
    return c.json(result, result.success ? 200 : 400);
  });

  app.post("/api/instances/:id/git/pull", async (c) => {
    const instance = instanceManager.getInstance(c.req.param("id"));
    if (!instance) {
      return c.json({ error: "Instance not found" }, 404);
    }
    const body = await readJsonBody<{ rebase?: boolean }>(c).catch(
      () => ({}) as { rebase?: boolean },
    );
    const result = await gitPull(instance.workingDirectory, { rebase: body.rebase === true });
    return c.json(result, result.success ? 200 : 400);
  });
}
