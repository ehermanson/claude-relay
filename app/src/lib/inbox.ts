/**
 * Pure inbox-model helpers: turning the project-grouped navigation model into
 * one flat, recency-sorted list and partitioning it into active vs done.
 *
 * Kept out of the hook so the rules that decide what appears in the inbox —
 * review-chat exclusion, closed-space chats counting as done, pinned ordering —
 * are testable without mounting the whole sidebar.
 */

import { isAttachedReviewInstance } from "@/lib/review-session";
import { compareChatListOrder, getChatRecencyTimestamp, isChatDone } from "@/lib/utils";
import type { InstanceInfo, SpaceInfo } from "@shared/types";

export interface InboxEntry {
  instance: InstanceInfo;
  /** Directory of the owning project — the stable key for filtering. */
  dir: string;
  /** Display name of the owning project. */
  projectName: string;
  /** Route identifier for the owning project (slug, UUID, or basename). */
  projectId: string;
  iconPath?: string;
  /** The space this chat belongs to, when it isn't in the implicit main space. */
  space?: SpaceInfo;
  done: boolean;
}

export interface InboxProjectOption {
  dir: string;
  name: string;
  /** Route identifier (slug, UUID, or basename). */
  projectId: string;
  /** Registered project UUID, when the directory is a registered project. */
  dbId?: string;
  iconPath?: string;
}

/** The subset of a sidebar navigation entry the inbox actually reads. */
export interface InboxSourceGroup {
  dir: string;
  name: string;
  projectId: string;
  iconPath?: string;
  groupInstances: InstanceInfo[];
  spaces: SpaceInfo[];
  project?: { id?: string };
}

/** Flatten project groups into one recency-sorted list, pinned chats first. */
export function buildInboxEntries(groups: readonly InboxSourceGroup[]): InboxEntry[] {
  const entries: InboxEntry[] = [];
  for (const group of groups) {
    const spacesById = new Map(group.spaces.map((space) => [space.id, space]));
    for (const instance of group.groupInstances) {
      // Review chats stay attached to the chat they audit — surfacing them as
      // peers in a flat list would double-count the same work.
      if (isAttachedReviewInstance(instance)) continue;
      const space = instance.spaceId ? spacesById.get(instance.spaceId) : undefined;
      entries.push({
        instance,
        dir: group.dir,
        projectName: group.name,
        projectId: group.projectId,
        iconPath: group.iconPath,
        space,
        done: isChatDone(instance, space?.status),
      });
    }
  }
  return entries.sort((a, b) => compareChatListOrder(a.instance, b.instance));
}

/** Scope to one project directory; `null` means every project. */
export function filterInboxEntries(
  entries: readonly InboxEntry[],
  projectFilter: string | null,
): InboxEntry[] {
  if (!projectFilter) return [...entries];
  return entries.filter((entry) => entry.dir === projectFilter);
}

export function partitionInboxEntries(entries: readonly InboxEntry[]): {
  active: InboxEntry[];
  done: InboxEntry[];
} {
  const active: InboxEntry[] = [];
  const done: InboxEntry[] = [];
  for (const entry of entries) (entry.done ? done : active).push(entry);
  // Done is an archive: a pin means "keep this in front of me", which a chat
  // marked done no longer needs — so the section orders by recency alone
  // rather than inheriting the active list's pinned-first sort.
  done.sort((a, b) => getChatRecencyTimestamp(b.instance) - getChatRecencyTimestamp(a.instance));
  return { active, done };
}

export function buildInboxProjectOptions(
  groups: readonly InboxSourceGroup[],
): InboxProjectOption[] {
  return groups.map((group) => ({
    dir: group.dir,
    name: group.name,
    projectId: group.projectId,
    dbId:
      group.project?.id ?? group.groupInstances.find((instance) => instance.projectId)?.projectId,
    iconPath: group.iconPath,
  }));
}
