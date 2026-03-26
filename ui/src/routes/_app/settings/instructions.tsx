import { createFileRoute } from "@tanstack/react-router";
import { InstructionsSettingsSection } from "../../../pages/global-settings-page";

export const Route = createFileRoute("/_app/settings/instructions")({
  component: InstructionsSettingsSection,
});
