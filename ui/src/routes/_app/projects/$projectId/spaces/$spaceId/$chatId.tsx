/**
 * Space + chat route: /projects/:projectId/spaces/:spaceId/:chatId
 *
 * Re-uses the SpaceView component from the index route, which reads chatId
 * from URL params to determine which tab is active.
 */
import { createFileRoute } from "@tanstack/react-router";
import { SpaceView } from "./index";

export const Route = createFileRoute("/_app/projects/$projectId/spaces/$spaceId/$chatId")({
  component: SpaceView,
});
