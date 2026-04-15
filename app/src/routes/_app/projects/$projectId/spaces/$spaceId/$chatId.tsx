/**
 * Space + chat route: /projects/:projectId/spaces/:spaceId/:chatId
 *
 * Re-uses the SpaceView component from the index route, which reads chatId
 * from URL params to determine which tab is active.
 */
import { createFileRoute } from "@tanstack/react-router";
import { validateChatSearch } from "@/routes/_app/projects/$projectId/chats/-search";
import { SpaceView } from "./index";

export const Route = createFileRoute("/_app/projects/$projectId/spaces/$spaceId/$chatId")({
  // SpaceView owns chat selection recovery. Keeping this loader passive avoids
  // stale REST data fighting with the pending new-chat flow.
  loader: async () => {},
  component: SpaceView,
  validateSearch: validateChatSearch,
});
