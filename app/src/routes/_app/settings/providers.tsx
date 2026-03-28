import { createFileRoute } from "@tanstack/react-router";
import { ProvidersSettingsSection } from "../../../pages/global-settings-page";

export const Route = createFileRoute("/_app/settings/providers")({
  component: ProvidersSettingsSection,
});
