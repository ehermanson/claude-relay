import { createFileRoute } from "@tanstack/react-router";
import { ChatsPage } from "../../../../../pages/chats-page";

export const Route = createFileRoute("/_app/projects/$projectId/chats/")({
  component: ChatsPage,
});
