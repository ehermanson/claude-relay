import { createFileRoute, redirect } from "@tanstack/react-router";

// The Chats tab was folded into Overview (Overview IS the chat list). Keep this
// path as a permanent redirect so old links/bookmarks land on the canonical
// project surface instead of a duplicate list.
export const Route = createFileRoute("/_app/projects/$projectId/chats/")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/projects/$projectId", params: { projectId: params.projectId } });
  },
});
