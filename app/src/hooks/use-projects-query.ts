import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWSMethods } from "@/context/websocket-context";
import { fetchProjects } from "@/lib/api";

export function useProjectsQuery() {
  const queryClient = useQueryClient();
  const { addMessageHandler } = useWSMethods();

  useEffect(() => {
    return addMessageHandler((message) => {
      if (message.type !== "projects_changed") {
        return;
      }
      queryClient.setQueryData(["projects"], message.projects);
    });
  }, [addMessageHandler, queryClient]);

  return useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    staleTime: 60_000,
  });
}
