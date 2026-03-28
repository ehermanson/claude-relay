import { lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";

const SettingsPage = lazy(() =>
  import("@/pages/settings-page").then((m) => ({ default: m.SettingsPage })),
);

export const Route = createFileRoute("/_app/projects/$projectId/settings/")({
  component: SettingsPage,
});
