import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createTask,
  deleteTask,
  hasTasks,
  initTasks,
  loadTasks,
  updateTask,
} from "../dist/server/core/task-manager.js";

describe("task-manager snapshot semantics", () => {
  let projectDir;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "relay-task-manager-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("initializes an empty canonical task snapshot", () => {
    assert.equal(hasTasks(projectDir), false);

    initTasks(projectDir);

    assert.equal(hasTasks(projectDir), true);
    assert.deepEqual(loadTasks(projectDir), []);
    assert.deepEqual(JSON.parse(readFileSync(join(projectDir, ".relay", "tasks.json"), "utf8")), {
      version: 1,
      tasks: [],
    });
  });

  it("derives blocked status from unresolved blockers without storing blocked", () => {
    const blocker = createTask(projectDir, { title: "Fix blocker" });
    const dependent = createTask(projectDir, {
      title: "Dependent work",
      blockedBy: [blocker.id],
    });

    assert.equal(loadTasks(projectDir).find((task) => task.id === dependent.id)?.status, "blocked");

    const storedBefore = JSON.parse(readFileSync(join(projectDir, ".relay", "tasks.json"), "utf8"));
    assert.equal(storedBefore.tasks.find((task) => task.id === dependent.id)?.status, "open");

    updateTask(projectDir, blocker.id, { status: "done" });

    assert.equal(loadTasks(projectDir).find((task) => task.id === dependent.id)?.status, "open");
  });

  it("refuses to complete parent tasks until open children are addressed", () => {
    const parent = createTask(projectDir, { title: "Parent" });
    const child = createTask(projectDir, { title: "Child", parent: parent.id });

    assert.throws(
      () => updateTask(projectDir, parent.id, { status: "done" }),
      /open children must be addressed/,
    );

    updateTask(projectDir, child.id, { status: "done" });
    const updatedParent = updateTask(projectDir, parent.id, { status: "done" });

    assert.equal(updatedParent.status, "done");
  });

  it("removes deleted task references from children and blockers", () => {
    const doomed = createTask(projectDir, { title: "Delete me" });
    const child = createTask(projectDir, { title: "Child", parent: doomed.id });
    const blocked = createTask(projectDir, {
      title: "Blocked",
      blockedBy: [doomed.id],
    });

    deleteTask(projectDir, doomed.id);

    const tasks = loadTasks(projectDir);
    assert.equal(
      tasks.some((task) => task.id === doomed.id),
      false,
    );
    assert.equal(tasks.find((task) => task.id === child.id)?.parent, null);
    assert.deepEqual(tasks.find((task) => task.id === blocked.id)?.blockedBy, []);
    assert.equal(tasks.find((task) => task.id === blocked.id)?.status, "open");
  });
});
