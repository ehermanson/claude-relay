import type { Hono } from "hono";
import * as taskManager from "../../../core/task-manager.js";
import {
  listBranches,
  getAheadBehind,
  checkoutBranch,
  gitFetch,
  gitPull,
  gitPush,
  isWorktreeDirty,
} from "../../../core/git.js";
import { readJsonBody, requireAuth } from "../hono-utils.js";
import type { ContextVariables, HttpDeps } from "../types.js";

export function registerProjectRoutes(
  app: Hono<{ Variables: ContextVariables }>,
  deps: HttpDeps,
): void {
  const { instanceManager } = deps;

  app.post("/api/projects/:id/tasks/init", (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    taskManager.initTasks(project.directory);
    return c.json({ snippet: taskManager.TASKS_CLAUDE_MD_SNIPPET });
  });

  app.get("/api/projects/:id/tasks", (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
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
    const session = requireAuth(c);
    if (session instanceof Response) return session;
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
      instanceManager.emit("tasks:changed", projectId, taskManager.loadTasks(project.directory));
      return c.json(task, 201);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to create task" }, 400);
    }
  });

  app.patch("/api/projects/:id/tasks/:taskId", async (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const projectId = c.req.param("id");
    const taskId = c.req.param("taskId");
    const project = instanceManager.projectManager.getProject(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    try {
      const body = await readJsonBody<taskManager.UpdateTaskInput>(c);
      const task = taskManager.updateTask(project.directory, taskId, body);
      instanceManager.emit("tasks:changed", projectId, taskManager.loadTasks(project.directory));
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
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const projectId = c.req.param("id");
    const taskId = c.req.param("taskId");
    const project = instanceManager.projectManager.getProject(projectId);
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    try {
      taskManager.deleteTask(project.directory, taskId);
      instanceManager.emit("tasks:changed", projectId, taskManager.loadTasks(project.directory));
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
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    return c.json(instanceManager.listProjectChats(project.id));
  });

  app.get("/api/projects", (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    return c.json({ projects: instanceManager.projectManager.listProjects() });
  });

  app.post("/api/projects", async (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
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
    const session = requireAuth(c);
    if (session instanceof Response) return session;
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
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    return c.json(project);
  });

  app.patch("/api/projects/:id", async (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    try {
      const body = await readJsonBody<{
        name?: string;
        targetBranch?: string | null;
        customInstructions?: string | null;
        defaultSpaceBranch?: string | null;
        spaceBranchSource?: "local" | "remote" | null;
        defaultProvider?: string | null;
        defaultModel?: string | null;
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
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const removed = instanceManager.projectManager.removeProject(c.req.param("id"));
    if (removed) {
      return c.json({ success: true });
    }
    return c.json({ error: "Project not found" }, 404);
  });

  app.get("/api/project-icons", (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    return c.json(instanceManager.getProjectIcons());
  });

  app.get("/api/project-artifacts/:name", (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const artifacts = instanceManager.getProjectArtifacts(c.req.param("name"));
    if (!artifacts) {
      return c.json({ error: "Project not found" }, 404);
    }
    return c.json(artifacts);
  });

  app.get("/api/projects/:id/branches", (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    const dir = project.repoRoot || project.directory;
    const branches = listBranches(dir);
    const aheadBehind = getAheadBehind(dir);
    const dirty = isWorktreeDirty(dir);
    return c.json({ ...branches, aheadBehind, dirty });
  });

  app.post("/api/projects/:id/checkout", async (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
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
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    const dir = project.repoRoot || project.directory;
    const result = await gitFetch(dir);
    return c.json(result, result.success ? 200 : 400);
  });

  app.post("/api/projects/:id/git/pull", async (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
    const project = instanceManager.projectManager.getProject(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }
    const dir = project.repoRoot || project.directory;
    const result = await gitPull(dir);
    return c.json(result, result.success ? 200 : 400);
  });

  app.post("/api/projects/:id/git/push", async (c) => {
    const session = requireAuth(c);
    if (session instanceof Response) return session;
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
}
