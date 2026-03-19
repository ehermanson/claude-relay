import { useEffect } from "react";
import { createFileRoute, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { InstanceView } from "@/components/chat/instance-view";
import { SplitChatView } from "@/components/chat/split-chat-view";
import { useWSState } from "@/context/websocket-context";
import { useMediaQuery } from "@/hooks/use-media-query";
import { getInstanceChatRoute } from "@/lib/project-route";
import { validateChatSearch } from "@/routes/_app/projects/$projectId/chats/-search";

function ChatRoute() {
  const navigate = useNavigate();
  const { chatId } = useParams({ from: "/_app/projects/$projectId/chats/$chatId" });
  const { split } = useSearch({ from: "/_app/projects/$projectId/chats/$chatId" });
  const { instances } = useWSState();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const instance = instances.find((entry) => entry.id === chatId);

  useEffect(() => {
    if (!instance?.spaceId) return;
    void navigate({
      ...getInstanceChatRoute(instance),
      replace: true,
    });
  }, [instance, navigate]);

  if (instance?.spaceId) {
    return null;
  }

  if (split && !isMobile) {
    return <SplitChatView splitId={split} />;
  }

  return <InstanceView />;
}

export const Route = createFileRoute("/_app/projects/$projectId/chats/$chatId")({
  component: ChatRoute,
  validateSearch: validateChatSearch,
});
