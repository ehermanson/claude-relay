import { createFileRoute } from "@tanstack/react-router";
import { GeneralSettingsSection } from "../../../pages/global-settings-page";

export const Route = createFileRoute("/_app/settings/general")({
  component: GeneralSettingsSection,
});
