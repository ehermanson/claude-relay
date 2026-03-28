import { useEffect } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useWSMethods } from "@/context/websocket-context";
import { fetchAllSpaces } from "@/lib/api";
import type { Project, SpaceInfo } from "@shared/types";

export function useProjectSpaces(projects: Project[]) {
  const queryClient = useQueryClient();
  const { addMessageHandler } = useWSMethods();

  useEffect(() => {
    const projectByDirectory = new Map(projects.map((project) => [project.directory, project]));
    return addMessageHandler((message) => {
      if (message.type !== "space_list") {
        return;
      }
      const project = projectByDirectory.get(message.projectDirectory);
      if (!project) {
        return;
      }
      queryClient.setQueryData(["spaces", project.id], message.spaces);
    });
  }, [addMessageHandler, projects, queryClient]);

  const spaceResults = useQueries({
    queries: projects.map((project) => ({
      queryKey: ["spaces", project.id],
      queryFn: () => fetchAllSpaces(project.id),
      staleTime: 60_000,
    })),
  });

  const entries: Array<[string, SpaceInfo[]]> = [];
  projects.forEach((project, index) => {
    entries.push([project.directory, spaceResults[index]?.data ?? []]);
  });
  return Object.fromEntries(entries) as Record<string, SpaceInfo[]>;
}
