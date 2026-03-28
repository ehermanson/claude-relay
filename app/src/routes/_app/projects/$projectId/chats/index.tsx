import { lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";

const ChatsPage = lazy(() => import("@/pages/chats-page").then((m) => ({ default: m.ChatsPage })));

export const Route = createFileRoute("/_app/projects/$projectId/chats/")({
  component: ChatsPage,
});
