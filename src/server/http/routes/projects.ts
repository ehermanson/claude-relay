import * as taskManager from "../../../core/task-manager.js";
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
      method: "GET",
      pattern: /^\/api\/projects\/([a-f0-9-]+)\/spaces$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const project = instanceManager.projectManager.getProject(match[1]);
        if (!project) {
          sendJson(ctx.res, 404, { error: "Project not found" });
          return;
        }
        sendJson(ctx.res, 200, instanceManager.getSpaceManager().listSpaces(project.directory));
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/projects\/([a-f0-9-]+)\/spaces$/,
      async handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const project = instanceManager.projectManager.getProject(match[1]);
        if (!project) {
          sendJson(ctx.res, 404, { error: "Project not found" });
          return;
        }
        try {
          const body = await readJsonBody<{ name?: string; baseBranch?: string }>(ctx.req);
          const space = instanceManager.getSpaceManager().createSpace(project.directory, {
            name: body.name,
            baseBranch: body.baseBranch,
          });
          sendJson(ctx.res, 201, space);
        } catch (err) {
          sendJson(ctx.res, 400, {
            error: err instanceof Error ? err.message : "Failed to create space",
          });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/spaces\/([a-f0-9-]+)$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const space = instanceManager.getSpaceManager().getSpace(match[1]);
        if (!space) {
          sendJson(ctx.res, 404, { error: "Space not found" });
          return;
        }
        sendJson(ctx.res, 200, space);
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/spaces\/([a-f0-9-]+)\/complete$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        try {
          const result = instanceManager.getSpaceManager().completeSpace(match[1]);
          sendJson(ctx.res, 200, { success: true, ...result });
        } catch (err) {
          sendJson(ctx.res, 400, {
            error: err instanceof Error ? err.message : "Failed to complete space",
          });
        }
      },
    },
    {
      method: "DELETE",
      pattern: /^\/api\/spaces\/([a-f0-9-]+)$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        try {
          instanceManager.getSpaceManager().deleteSpace(match[1]);
          sendJson(ctx.res, 200, { success: true });
        } catch (err) {
          sendJson(ctx.res, 400, {
            error: err instanceof Error ? err.message : "Failed to delete space",
          });
        }
      },
    },
    {
      method: "GET",
      pattern: /^\/api\/spaces\/([a-f0-9-]+)\/diff$/,
      handler(ctx, match) {
        if (!requireAuth(ctx)) {
          return;
        }
        const diff = instanceManager.getSpaceManager().getSpaceDiff(match[1]);
        if (diff == null) {
          sendJson(ctx.res, 404, { error: "Space not found" });
          return;
        }
        sendJson(ctx.res, 200, { diff });
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
  ];
}
