import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/pages/settings-page";

export const Route = createFileRoute("/_app/projects/$projectId/settings/")({
  component: SettingsPage,
});
