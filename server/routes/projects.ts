import type { Hono } from "hono";
import * as taskManager from "#core/task-manager.js";
import {
  checkoutBranch,
  commitAll,
  getAheadBehind,
  gitFetch,
  gitPull,
  gitPush,
  isWorktreeDirty,
  listBranches,
  listWorktrees,
} from "#core/git.js";
import { resolveSuggestions } from "#core/actions.js";
import { readJsonBody } from "#server/hono-utils.js";
import type { AppEnv, HttpDeps } from "#server/route-types.js";
import type { SuggestionsConfig } from "#core/types.js";

export function registerProjectRoutes(app: Hono<AppEnv>, deps: HttpDeps): void {
  const { instanceManager } = deps;

  app.post("/api/projects/:id/tasks/init", (c) => {
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    taskManager.initTasks(project.directory);
    return c.json({ snippet: taskManager.TASKS_CLAUDE_MD_SNIPPET });
  });

  app.get("/api/projects/:id/tasks", (c) => {
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    const tasks = taskManager.hasTasks(project.directory)
      ? taskManager.loadTasks(project.directory)
      : null;
    return c.json({ tasks });
  });

  app.post("/api/projects/:id/tasks", async (c) => {
    const projectId = c.req.param("id");
    const project = instanceManager.projectManager.getProject(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    try {
      const body = await readJsonBody<taskManager.CreateTaskInput>(c);
      if (!body.title || typeof body.title !== "string") {
        return c.json({ error: "Missing title" }, 400);
      }
      const task = taskManager.createTask(project.directory, body);
      instanceManager.emit("tasks:changed", project.id, taskManager.loadTasks(project.directory));
      return c.json(task, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to create task" }, 400);
    }
  });

  app.patch("/api/projects/:id/tasks/:taskId", async (c) => {
    const projectId = c.req.param("id");
    const taskId = c.req.param("taskId");
    const project = instanceManager.projectManager.getProject(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    try {
      const body = await readJsonBody<taskManager.UpdateTaskInput>(c);
      const task = taskManager.updateTask(project.directory, taskId, body);
      instanceManager.emit("tasks:changed", project.id, taskManager.loadTasks(project.directory));
      return c.json(task);
    } catch (err) {
      const status = (err as Error).message?.includes("not found") ? 404 : 400;
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to update task" },
        status,
      );
    }
  });

  app.delete("/api/projects/:id/tasks/:taskId", (c) => {
    const projectId = c.req.param("id");
    const taskId = c.req.param("taskId");
    const project = instanceManager.projectManager.getProject(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    try {
      taskManager.deleteTask(project.directory, taskId);
      instanceManager.emit("tasks:changed", project.id, taskManager.loadTasks(project.directory));
      return c.body(null, 204);
    } catch (err) {
      const status = (err as Error).message?.includes("not found") ? 404 : 400;
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to delete task" },
        status,
      );
    }
  });

  app.get("/api/projects/:id/chats", (c) => {
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    return c.json(instanceManager.listProjectChats(project.id));
  });

  app.get("/api/projects", (c) => {
    return c.json({ projects: instanceManager.projectManager.listProjects() });
  });

  app.post("/api/projects", async (c) => {
    try {
      const body = await readJsonBody<{
        directory?: string;
        name?: string;
        targetBranch?: string;
      }>(c);
      if (!body.directory || typeof body.directory !== "string") {
        return c.json({ error: "Missing directory" }, 400);
      }
      const project = instanceManager.projectManager.addProject(body.directory, {
        name: body.name,
        targetBranch: body.targetBranch,
      });
      instanceManager.rescanAll();
      return c.json(project, 201);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to register project" },
        400,
      );
    }
  });

  app.post("/api/projects/init", async (c) => {
    try {
      const body = await readJsonBody<{
        parentDirectory?: string;
        name?: string;
      }>(c);
      if (!body.parentDirectory || typeof body.parentDirectory !== "string") {
        return c.json({ error: "Missing parentDirectory" }, 400);
      }
      if (!body.name || typeof body.name !== "string") {
        return c.json({ error: "Missing name" }, 400);
      }
      const project = instanceManager.projectManager.initProject(
        body.parentDirectory,
        body.name.trim(),
      );
      instanceManager.rescanAll();
      return c.json(project, 201);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to create project" },
        400,
      );
    }
  });

  app.get("/api/projects/:id", (c) => {
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    return c.json(project);
  });

  app.patch("/api/projects/:id", async (c) => {
    try {
      const body = await readJsonBody<{
        name?: string;
        targetBranch?: string | null;
        customInstructions?: string | null;
        defaultSpaceBranch?: string | null;
        spaceBranchSource?: "local" | "remote" | null;
        defaultProvider?: string | null;
        defaultModel?: string | null;
        suggestions?: import("#core/types.js").SuggestionsConfig | null;
      }>(c);
      const project = instanceManager.projectManager.updateProject(c.req.param("id"), body);
      if (!project) {
        return c.json({ error: "Project not found" }, 404);
      }
      return c.json(project);
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to update project" },
        400,
      );
    }
  });

  app.delete("/api/projects/:id", (c) => {
    const removed = instanceManager.projectManager.removeProject(c.req.param("id"));
    if (removed) {
      return c.json({ success: true });
    }
    return c.json({ error: "Project not found" }, 404);
  });

  /** Get resolved suggestions for a project (built-in + global + project layers). */
  app.get("/api/projects/:id/suggestions", (c) => {
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) return c.json({ error: "Project not found" }, 404);

    const globalRow = instanceManager.sessionDb.getGlobalSettings();
    let globalSuggestions: SuggestionsConfig | null = null;
    if (globalRow.suggestions_json) {
      try {
        globalSuggestions = JSON.parse(globalRow.suggestions_json);
      } catch {}
    }

    // Check for open tasks (server-evaluated condition)
    let hasOpenTasks = false;
    if (taskManager.hasTasks(project.directory)) {
      const tasks = taskManager.loadTasks(project.directory);
      hasOpenTasks = tasks.some((t) => t.status === "open" || t.status === "in_progress");
    }

    return c.json(resolveSuggestions(globalSuggestions, project.suggestions, { hasOpenTasks }));
  });

  app.get("/api/project-icons", (c) => {
    return c.json(instanceManager.getProjectIcons());
  });

  app.get("/api/project-artifacts/:name", (c) => {
    const artifacts = instanceManager.getProjectArtifacts(c.req.param("name"));
    if (!artifacts) {
      return c.json({ error: "Project not found" }, 404);
    }
    return c.json(artifacts);
  });

  app.get("/api/projects/:id/branches", (c) => {
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    const dir = project.repoRoot || project.directory;
    const branches = listBranches(dir);
    const aheadBehind = getAheadBehind(dir);
    const dirty = isWorktreeDirty(dir);
    const spaceManager = instanceManager.getSpaceManager();
    const worktrees = listWorktrees(dir)
      .filter((w) => !w.isPrimary && w.branch)
      .map((w) => ({
        branch: w.branch as string,
        path: w.path,
        spaceId: spaceManager.getSpaceByWorktreePath(w.path)?.id,
      }));
    return c.json({ ...branches, aheadBehind, dirty, worktrees });
  });

  app.post("/api/projects/:id/checkout", async (c) => {
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    try {
      const body = await readJsonBody<{ branch: string }>(c);
      if (!body.branch) {
        return c.json({ error: "branch is required" }, 400);
      }
      const dir = project.repoRoot || project.directory;
      checkoutBranch(dir, body.branch);
      const branches = listBranches(dir);
      const aheadBehind = getAheadBehind(dir);
      return c.json({ ...branches, aheadBehind });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "Failed to checkout branch" },
        400,
      );
    }
  });

  app.post("/api/projects/:id/git/fetch", async (c) => {
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    const dir = project.repoRoot || project.directory;
    const result = await gitFetch(dir);
    return c.json(result, result.success ? 200 : 400);
  });

  app.post("/api/projects/:id/git/pull", async (c) => {
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    const dir = project.repoRoot || project.directory;
    const result = await gitPull(dir);
    return c.json(result, result.success ? 200 : 400);
  });

  app.post("/api/projects/:id/git/push", async (c) => {
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    try {
      const body = await readJsonBody<{
        branch?: string;
        setUpstream?: boolean;
      }>(c);
      const dir = project.repoRoot || project.directory;
      const result = await gitPush(dir, body.branch, body.setUpstream);
      return c.json(result, result.success ? 200 : 400);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to push" }, 400);
    }
  });

  app.post("/api/projects/:id/git/commit", async (c) => {
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    try {
      const body = await readJsonBody<{ message?: string }>(c);
      const dir = project.repoRoot || project.directory;
      if (!isWorktreeDirty(dir)) {
        return c.json({ success: false, error: "Nothing to commit — working tree is clean" }, 400);
      }
      const result = commitAll(dir, body.message || "Commit via Relay");
      return c.json(result, result.success ? 200 : 400);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to commit" }, 400);
    }
  });
}
