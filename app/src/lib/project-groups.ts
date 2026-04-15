import type { InstanceInfo, Project } from "@shared/types";
import { getChatRecencyTimestamp } from "@/lib/utils";

function getInstanceProjectDirectory(
  instance: Pick<InstanceInfo, "projectId" | "originalDirectory" | "workingDirectory">,
  projectById: Map<string, Pick<Project, "directory">>,
): string {
  return (
    (instance.projectId ? projectById.get(instance.projectId)?.directory : undefined) ??
    instance.originalDirectory ??
    instance.workingDirectory
  );
}

export function groupInstancesByProject(
  instances: InstanceInfo[],
  projects: Project[],
): Array<[string, InstanceInfo[]]> {
  const projectById = new Map(projects.map((project) => [project.id, project] as const));
  const registeredDirs = new Set(projects.map((project) => project.directory));
  const groupMap = new Map<string, InstanceInfo[]>();

  for (const instance of instances) {
    const dir = getInstanceProjectDirectory(instance, projectById);
    if (registeredDirs.size > 0 && !registeredDirs.has(dir)) {
      continue;
    }
    const group = groupMap.get(dir) ?? [];
    group.push(instance);
    groupMap.set(dir, group);
  }

  for (const project of projects) {
    if (!groupMap.has(project.directory)) {
      groupMap.set(project.directory, []);
    }
  }

  for (const group of groupMap.values()) {
    group.sort((a, b) => getChatRecencyTimestamp(b) - getChatRecencyTimestamp(a));
  }

  return Array.from(groupMap.entries());
}
