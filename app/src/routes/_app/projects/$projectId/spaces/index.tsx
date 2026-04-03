import { lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";

const SpacesPage = lazy(() =>
  import("@/pages/spaces-page").then((m) => ({ default: m.SpacesPage })),
);

export const Route = createFileRoute("/_app/projects/$projectId/spaces/")({
  component: SpacesPage,
});
