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
import type { Route, HttpDeps } from "../types.js";
import { readJsonBody } from "../body.js";
import { requireAuth } from "../guards.js";
import { sendJson } from "../respond.js";

export function createProjectRoutes(deps: HttpDeps): Route[] {
  const { instanceManager } = deps;

  return [
    {
      method: "POST",
      pattern: /^\/api\/projects\/([a-f0-9-]+)\/tasks\/init$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const project = instanceManager.projectManager.getProject(match[1]);
        if (!project) {
          sendJson(ctx.res, 404, { error: "Project not found" });
          return;
        }
        taskManager.initTasks(project.directory);
        sendJson(ctx.res, 200, { snippet: taskManager.TASKS_CLAUDE_MD_SNIPPET });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/projects\/([a-f0-9-]+)\/tasks$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const project = instanceManager.projectManager.getProject(match[1]);
        if (!project) {
          sendJson(ctx.res, 404, { error: "Project not found" });
          return;
        }
        const tasks = taskManager.hasTasks(project.directory)
          ? taskManager.loadTasks(project.directory)
          : null;
        sendJson(ctx.res, 200, { tasks });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/projects\/([a-f0-9-]+)\/tasks$/,
      async handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const projectId = match[1];
        const project = instanceManager.projectManager.getProject(projectId);
        if (!project) {
          sendJson(ctx.res, 404, { error: "Project not found" });
          return;
        }
        try {
          const body = await readJsonBody<taskManager.CreateTaskInput>(ctx.req);
          if (!body.title || typeof body.title !== "string") {
            sendJson(ctx.res, 400, { error: "Missing title" });
            return;
          }
          const task = taskManager.createTask(project.directory, body);
          instanceManager.emit(
            "tasks:changed",
            projectId,
            taskManager.loadTasks(project.directory),
          );
          sendJson(ctx.res, 201, task);
        } catch (err) {
          sendJson(ctx.res, 400, {
            error: err instanceof Error ? err.message : "Failed to create task",
          });
        }
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/projects\/([a-f0-9-]+)\/tasks\/([^/]+)$/,
      async handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const projectId = match[1];
        const taskId = match[2];
        const project = instanceManager.projectManager.getProject(projectId);
        if (!project) {
          sendJson(ctx.res, 404, { error: "Project not found" });
          return;
        }
        try {
          const body = await readJsonBody<taskManager.UpdateTaskInput>(ctx.req);
          const task = taskManager.updateTask(project.directory, taskId, body);
          instanceManager.emit(
            "tasks:changed",
            projectId,
            taskManager.loadTasks(project.directory),
          );
          sendJson(ctx.res, 200, task);
        } catch (err) {
          const status = (err as Error).message?.includes("not found") ? 404 : 400;
          sendJson(ctx.res, status, {
            error: err instanceof Error ? err.message : "Failed to update task",
          });
        }
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/projects\/([a-f0-9-]+)\/tasks\/([^/]+)$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const projectId = match[1];
        const taskId = match[2];
        const project = instanceManager.projectManager.getProject(projectId);
        if (!project) {
          sendJson(ctx.res, 404, { error: "Project not found" });
          return;
        }
        try {
          taskManager.deleteTask(project.directory, taskId);
          instanceManager.emit(
            "tasks:changed",
            projectId,
            taskManager.loadTasks(project.directory),
          );
          sendJson(ctx.res, 204, null);
        } catch (err) {
          const status = (err as Error).message?.includes("not found") ? 404 : 400;
          sendJson(ctx.res, status, {
            error: err instanceof Error ? err.message : "Failed to delete task",
          });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/projects\/([a-f0-9-]+)\/chats$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const project = instanceManager.projectManager.getProject(match[1]);
        if (!project) {
          sendJson(ctx.res, 404, { error: "Project not found" });
          return;
        }
        sendJson(ctx.res, 200, instanceManager.listProjectChats(project.id));
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/projects$/,
      handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }
        sendJson(ctx.res, 200, { projects: instanceManager.projectManager.listProjects() });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/projects$/,
      async handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }
        try {
          const body = await readJsonBody<{
            directory?: string;
            name?: string;
            targetBranch?: string;
          }>(ctx.req);
          if (!body.directory || typeof body.directory !== "string") {
            sendJson(ctx.res, 400, { error: "Missing directory" });
            return;
          }
          const project = instanceManager.projectManager.addProject(body.directory, {
            name: body.name,
            targetBranch: body.targetBranch,
          });
          instanceManager.rescanAll();
          sendJson(ctx.res, 201, project);
        } catch (err) {
          sendJson(ctx.res, 400, {
            error: err instanceof Error ? err.message : "Failed to register project",
          });
        }
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/projects\/init$/,
      async handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }
        try {
          const body = await readJsonBody<{
            parentDirectory?: string;
            name?: string;
          }>(ctx.req);
          if (!body.parentDirectory || typeof body.parentDirectory !== "string") {
            sendJson(ctx.res, 400, { error: "Missing parentDirectory" });
            return;
          }
          if (!body.name || typeof body.name !== "string") {
            sendJson(ctx.res, 400, { error: "Missing name" });
            return;
          }
          const project = instanceManager.projectManager.initProject(
            body.parentDirectory,
            body.name.trim(),
          );
          instanceManager.rescanAll();
          sendJson(ctx.res, 201, project);
        } catch (err) {
          sendJson(ctx.res, 400, {
            error: err instanceof Error ? err.message : "Failed to create project",
          });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/projects\/([a-f0-9-]+)$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const project = instanceManager.projectManager.getProject(match[1]);
        if (!project) {
          sendJson(ctx.res, 404, { error: "Project not found" });
          return;
        }
        sendJson(ctx.res, 200, project);
      },
    },
    {
      method: "PATCH",
      pattern: /^\/api\/projects\/([a-f0-9-]+)$/,
      async handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        try {
          const body = await readJsonBody<{
            name?: string;
            targetBranch?: string | null;
            customInstructions?: string | null;
            defaultSpaceBranch?: string | null;
            defaultProvider?: string | null;
            defaultModel?: string | null;
          }>(ctx.req);
          const project = instanceManager.projectManager.updateProject(match[1], body);
          if (!project) {
            sendJson(ctx.res, 404, { error: "Project not found" });
            return;
          }
          sendJson(ctx.res, 200, project);
        } catch (err) {
          sendJson(ctx.res, 400, {
            error: err instanceof Error ? err.message : "Failed to update project",
          });
        }
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/projects\/([a-f0-9-]+)$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const removed = instanceManager.projectManager.removeProject(match[1]);
        if (removed) {
          sendJson(ctx.res, 200, { success: true });
          return;
        }
        sendJson(ctx.res, 404, { error: "Project not found" });
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/project-icons$/,
      handler(ctx) {
        if (!requireAuth(ctx)) {
          return;
        }
        sendJson(ctx.res, 200, instanceManager.getProjectIcons());
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/project-artifacts\/([-a-zA-Z0-9_.]+)$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const artifacts = instanceManager.getProjectArtifacts(match[1]);
        if (!artifacts) {
          sendJson(ctx.res, 404, { error: "Project not found" });
          return;
        }
        sendJson(ctx.res, 200, artifacts);
      },
    },

    // ─── Branch Management ──────────────────────────────────────────────

    {
      method: "GET",
      pattern: /^\/api\/projects\/([a-f0-9-]+)\/branches$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) return;
        const project = instanceManager.projectManager.getProject(match[1]);
        if (!project) {
          sendJson(ctx.res, 404, { error: "Project not found" });
          return;
        }
        const dir = project.repoRoot || project.directory;
        const branches = listBranches(dir);
        const aheadBehind = getAheadBehind(dir);
        const dirty = isWorktreeDirty(dir);
        sendJson(ctx.res, 200, { ...branches, aheadBehind, dirty });
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/projects\/([a-f0-9-]+)\/checkout$/,
      async handler(ctx, match) {
        if (!requireAuth(ctx)) return;
        const project = instanceManager.projectManager.getProject(match[1]);
        if (!project) {
          sendJson(ctx.res, 404, { error: "Project not found" });
          return;
        }
        try {
          const body = await readJsonBody<{ branch: string }>(ctx.req);
          if (!body.branch) {
            sendJson(ctx.res, 400, { error: "branch is required" });
            return;
          }
          const dir = project.repoRoot || project.directory;
          checkoutBranch(dir, body.branch);
          const branches = listBranches(dir);
          const aheadBehind = getAheadBehind(dir);
          sendJson(ctx.res, 200, { ...branches, aheadBehind });
        } catch (err) {
          sendJson(ctx.res, 400, {
            error: err instanceof Error ? err.message : "Failed to checkout branch",
          });
        }
      },
    },

    // ─── Remote Git Operations ──────────────────────────────────────────

    {
      method: "POST",
      pattern: /^\/api\/projects\/([a-f0-9-]+)\/git\/fetch$/,
      async handler(ctx, match) {
        if (!requireAuth(ctx)) return;
        const project = instanceManager.projectManager.getProject(match[1]);
        if (!project) {
          sendJson(ctx.res, 404, { error: "Project not found" });
          return;
        }
        const dir = project.repoRoot || project.directory;
        const result = await gitFetch(dir);
        sendJson(ctx.res, result.success ? 200 : 400, result);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/projects\/([a-f0-9-]+)\/git\/pull$/,
      async handler(ctx, match) {
        if (!requireAuth(ctx)) return;
        const project = instanceManager.projectManager.getProject(match[1]);
        if (!project) {
          sendJson(ctx.res, 404, { error: "Project not found" });
          return;
        }
        const dir = project.repoRoot || project.directory;
        const result = await gitPull(dir);
        sendJson(ctx.res, result.success ? 200 : 400, result);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/projects\/([a-f0-9-]+)\/git\/push$/,
      async handler(ctx, match) {
        if (!requireAuth(ctx)) return;
        const project = instanceManager.projectManager.getProject(match[1]);
        if (!project) {
          sendJson(ctx.res, 404, { error: "Project not found" });
          return;
        }
        try {
          const body = await readJsonBody<{
            branch?: string;
            setUpstream?: boolean;
          }>(ctx.req);
          const dir = project.repoRoot || project.directory;
          const result = await gitPush(dir, body.branch, body.setUpstream);
          sendJson(ctx.res, result.success ? 200 : 400, result);
        } catch (err) {
          sendJson(ctx.res, 400, {
            error: err instanceof Error ? err.message : "Failed to push",
          });
        }
      },
    },
  ];
}
