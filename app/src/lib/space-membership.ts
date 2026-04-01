import type { InstanceInfo, SpaceInfo } from "@shared/types";

function inferSpaceMatch(instance: InstanceInfo, space: SpaceInfo): boolean {
  if (space.isDefault) {
    return false;
  }

  if (space.worktreePath && instance.workingDirectory === space.worktreePath) {
    return true;
  }

  return Boolean(
    instance.originalDirectory === space.projectDirectory &&
    instance.gitBranch &&
    space.gitBranch &&
    instance.gitBranch === space.gitBranch,
  );
}

export function getResolvedSpaceId(
  instance: InstanceInfo,
  spaces: SpaceInfo[] | undefined,
): string | undefined {
  if (instance.spaceId) {
    return instance.spaceId;
  }

  return spaces?.find((space) => inferSpaceMatch(instance, space))?.id;
}

export function isSpaceOwnedInstance(
  instance: InstanceInfo,
  spaces: SpaceInfo[] | undefined,
): boolean {
  return Boolean(getResolvedSpaceId(instance, spaces));
}
