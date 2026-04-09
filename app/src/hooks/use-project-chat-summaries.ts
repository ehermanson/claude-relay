import { useEffect } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useWSMethods } from "@/context/websocket-context";
import { fetchProjectChats } from "@/lib/api";
import type { InstanceInfo, Project } from "@shared/types";

export function useProjectChatSummaries(projects: Project[]) {
  const queryClient = useQueryClient();
  const { addMessageHandler } = useWSMethods();

  useEffect(() => {
    return addMessageHandler((message) => {
      if (message.type === "instance_created" && message.instance.projectId) {
        void queryClient.invalidateQueries({
          queryKey: ["projectChats", message.instance.projectId],
        });
        return;
      }
      if (message.type === "instance_removed") {
        void queryClient.invalidateQueries({ queryKey: ["projectChats"] });
      }
    });
  }, [addMessageHandler, queryClient]);

  const chatResults = useQueries({
    queries: projects.map((project) => ({
      queryKey: ["projectChats", project.id],
      queryFn: () => fetchProjectChats(project.id),
      staleTime: 60_000,
    })),
  });

  const chatsByProjectId: Record<string, InstanceInfo[]> = {};
  const chatsLoadingByProjectId: Record<string, boolean> = {};
  projects.forEach((project, index) => {
    chatsByProjectId[project.id] = chatResults[index]?.data ?? [];
    chatsLoadingByProjectId[project.id] = chatResults[index]?.isLoading ?? false;
  });
  return { chatsByProjectId, chatsLoadingByProjectId };
}
