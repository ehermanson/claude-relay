import type { InstanceInfo } from "@shared/types";

export function getResolvedSpaceId(instance: InstanceInfo, _spaces?: unknown): string | undefined {
  return instance.spaceId;
}

export function isSpaceOwnedInstance(instance: InstanceInfo, spaces?: unknown): boolean {
  return Boolean(getResolvedSpaceId(instance, spaces));
}
