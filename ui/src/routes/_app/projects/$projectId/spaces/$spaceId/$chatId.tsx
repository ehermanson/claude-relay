/**
 * Space + chat route: /projects/:projectId/spaces/:spaceId/:chatId
 *
 * Re-uses the SpaceView component from the index route, which reads chatId
 * from URL params to determine which tab is active.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { fetchProjectChats } from "@/lib/api";
import { SpaceView } from "./index";

export const Route = createFileRoute("/_app/projects/$projectId/spaces/$spaceId/$chatId")({
  loader: async ({ params }) => {
    const chats = await fetchProjectChats(params.projectId);
    const spaceChats = chats
      .filter((chat) => chat.spaceId === params.spaceId)
      .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));

    const activeChat = spaceChats.find((chat) => chat.id === params.chatId);
    if (activeChat) return;

    const fallbackChat = spaceChats[0];
    if (fallbackChat) {
      throw redirect({
        to: "/projects/$projectId/spaces/$spaceId/$chatId",
        params: {
          projectId: params.projectId,
          spaceId: params.spaceId,
          chatId: fallbackChat.id,
        },
        replace: true,
      });
    }

    throw redirect({
      to: "/projects/$projectId/spaces/$spaceId",
      params: {
        projectId: params.projectId,
        spaceId: params.spaceId,
      },
      replace: true,
    });
  },
  component: SpaceView,
});
