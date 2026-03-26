import { createFileRoute } from "@tanstack/react-router";
import { GitSettingsSection } from "../../../pages/global-settings-page";

export const Route = createFileRoute("/_app/settings/git")({
  component: GitSettingsSection,
});
