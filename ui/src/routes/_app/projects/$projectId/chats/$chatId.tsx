import { createFileRoute } from "@tanstack/react-router";
import { InstanceView } from "../../../../../components/chat/instance-view";

export const Route = createFileRoute("/_app/projects/$projectId/chats/$chatId")({
  component: InstanceView,
});
