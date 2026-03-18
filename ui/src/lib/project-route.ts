import type { InstanceInfo } from "@shared/types";

export type RemoveProjectTarget = {
  id?: string;
  name: string;
  directory: string;
};

export function getProjectName(directory: string): string {
  return directory.split("/").pop() || directory;
}

export function getInstanceProjectRouteId(
  instance: Pick<InstanceInfo, "projectId" | "workingDirectory">,
): string {
  return instance.projectId ?? getProjectName(instance.workingDirectory);
}

export function instanceMatchesProject(
  instance: Pick<InstanceInfo, "projectId" | "workingDirectory">,
  projectId: string,
): boolean {
  return getInstanceProjectRouteId(instance) === projectId;
}
