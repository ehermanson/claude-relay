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
  /**
   * Whether this directory can back a Space. Chat creation tolerates
   * unregistered dirs (creating one registers the project), but Space creation
   * needs a registered project to resolve a `projectId` — a session-only group
   * (e.g. an external chat in an unregistered directory) would dead-end the
   * create-space dialog on "Project not found". Set from the registered-project
   * signal `group.project`.
   */
  spaceCapable: boolean;
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

/**
 * How long a chat must sit untouched before the inbox offers to sweep it into
 * Done. Deliberately a manual action, not a rule that runs on its own — nothing
 * marks a chat done behind the user's back.
 */
export const STALE_CHAT_DONE_DAYS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Active chats with no activity for `days` — the ones the sweep would mark
 * done. Chats mid-turn are excluded (staleness is about the backlog, and a
 * working agent is by definition unfinished), as are chats with no recorded
 * activity at all: recency 0 means "unknown", not "ancient", and a chat created
 * seconds ago but never messaged reads that way.
 */
export function selectStaleInboxEntries(
  entries: readonly InboxEntry[],
  now: number,
  days: number = STALE_CHAT_DONE_DAYS,
): InboxEntry[] {
  const cutoff = now - days * DAY_MS;
  return entries.filter((entry) => {
    if (entry.done || entry.instance.status === "processing") return false;
    const recencyAt = getChatRecencyTimestamp(entry.instance);
    return recencyAt > 0 && recencyAt < cutoff;
  });
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
    // Only a registered project (`group.project` present) can resolve a
    // projectId for the create-space dialog; a session-only group can't.
    spaceCapable: !!group.project,
  }));
}

/**
 * What a shared "New" trigger should render, resolved from the target set. The
 * component stays a thin renderer over this so the branching — direct-create vs
 * picker, chat-only vs combined, and the space-capability filter — is unit
 * testable without mounting a menu.
 *
 * Space creation is offered only for `spaceCapable` targets. When none apply
 * (space disabled, or the sole/only targets can't back a space) the shape falls
 * back to the original chat-only behavior, including direct-create for a lone
 * target.
 */
export type NewMenuShape =
  | { kind: "chat-direct"; dir: string }
  | { kind: "chat-picker"; chatProjects: InboxProjectOption[] }
  | { kind: "combined-direct"; dir: string }
  | {
      kind: "combined-picker";
      chatProjects: InboxProjectOption[];
      spaceProjects: InboxProjectOption[];
    };

export function resolveNewMenuShape(
  projectOptions: readonly InboxProjectOption[],
  soleTarget: string | null,
  spaceEnabled: boolean,
): NewMenuShape {
  const spaceProjects = spaceEnabled ? projectOptions.filter((option) => option.spaceCapable) : [];

  if (soleTarget) {
    const canSpace = spaceProjects.some((option) => option.dir === soleTarget);
    return canSpace
      ? { kind: "combined-direct", dir: soleTarget }
      : { kind: "chat-direct", dir: soleTarget };
  }

  if (spaceProjects.length > 0) {
    return { kind: "combined-picker", chatProjects: [...projectOptions], spaceProjects };
  }
  return { kind: "chat-picker", chatProjects: [...projectOptions] };
}
