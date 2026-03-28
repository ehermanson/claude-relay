import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "../../pages/chat-page";

export const Route = createFileRoute("/_app/")({
  component: Dashboard,
});
