import { useEffect } from "react";
import { useWSState } from "@/context/websocket-context";
import { groupInstancesByProject } from "@/lib/project-groups";
import { useProjectChatSummaries } from "./use-project-chat-summaries";
import { useProjectOrder } from "./use-project-order";
import { useProjectsQuery } from "./use-projects-query";
import { useProjectSpaces } from "./use-project-spaces";
import type { InstanceInfo, Project } from "@shared/types";

export function useProjectNavigationModel() {
  const { instances } = useWSState();
  const { data: projects = [] } = useProjectsQuery();
  const projectSpaces = useProjectSpaces(projects);
  const chatsByProjectId = useProjectChatSummaries(projects);
  const projectOrder = useProjectOrder();

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

  useEffect(() => {
    projectOrder.syncVisibleDirs(groups.map(([dir]) => dir));
    // deps: instances/projects drive the group list; avoid `groups` (new ref every render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances, projects]);

  const projectByDir = new Map<string, Project>();
  for (const project of projects) {
    projectByDir.set(project.directory, project);
  }
  const registeredDirs = new Set(projects.map((project) => project.directory));

  return {
    groups,
    projectByDir,
    projectSpaces,
    projects,
    registeredDirs,
    ...projectOrder,
  };
}
