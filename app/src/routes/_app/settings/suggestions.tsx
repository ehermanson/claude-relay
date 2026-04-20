import { createFileRoute } from "@tanstack/react-router";
import { SuggestionsSettingsSection } from "../../../pages/global-settings-page";

export const Route = createFileRoute("/_app/settings/suggestions")({
  component: SuggestionsSettingsSection,
});
