import { useEffect } from "react";
import { useWSState } from "@/context/websocket-context";
import { groupInstancesByProject } from "@/lib/project-groups";
import { useProjectChatSummaries } from "./use-project-chat-summaries";
import { useProjectOrder } from "../stores/project-order-store";
import { useProjectOrderHydration } from "./use-project-order-hydration";
import { useProjectsQuery } from "./use-projects-query";
import { useProjectSpaces } from "./use-project-spaces";
import { getChatRecencyTimestamp } from "@/lib/utils";
import type { InstanceInfo, Project } from "@shared/types";

export function useProjectNavigationModel() {
  const { instances } = useWSState();
  const { data: projects = [], isLoading: projectsLoading } = useProjectsQuery();
  const { spacesByDir: projectSpaces, spacesLoadingByDir } = useProjectSpaces(projects);
  const { chatsByProjectId, chatsLoadingByProjectId } = useProjectChatSummaries(projects);
  const projectOrder = useProjectOrder();
  const { syncVisibleDirs } = projectOrder;
  useProjectOrderHydration();

  const mergedInstances = new Map<string, InstanceInfo>();
  for (const project of projects) {
    const chats = chatsByProjectId[project.id] ?? [];
    for (const chat of chats) {
      mergedInstances.set(chat.id, chat);
    }
  }
  for (const instance of instances) {
    mergedInstances.set(instance.id, instance);
  }

  const groups = projectOrder.sortEntries(
    groupInstancesByProject(Array.from(mergedInstances.values()), projects),
  );
  const groupDirs = groups.map(([dir]) => dir);
  const groupDirsKey = groupDirs.join("\0");

  const latestChatIdBySpace: Record<string, string> = {};
  const latestActivityBySpace = new Map<string, number>();
  for (const instance of mergedInstances.values()) {
    if (!instance.spaceId) continue;
    const activityAt = getChatRecencyTimestamp(instance);
    const previous = latestActivityBySpace.get(instance.spaceId) ?? Number.NEGATIVE_INFINITY;
    if (activityAt >= previous) {
      latestActivityBySpace.set(instance.spaceId, activityAt);
      latestChatIdBySpace[instance.spaceId] = instance.id;
    }
  }

  useEffect(() => {
    syncVisibleDirs(groupDirs);
  }, [groupDirs, groupDirsKey, syncVisibleDirs]);

  const projectByDir = new Map<string, Project>();
  for (const project of projects) {
    projectByDir.set(project.directory, project);
  }
  const registeredDirs = new Set(projects.map((project) => project.directory));

  return {
    chatsLoadingByProjectId,
    spacesLoadingByDir,
    groups,
    latestChatIdBySpace,
    projectByDir,
    projectSpaces,
    projects,
    projectsLoading,
    registeredDirs,
    ...projectOrder,
  };
}
