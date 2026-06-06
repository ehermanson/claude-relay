import { createFileRoute } from "@tanstack/react-router";
import { SuggestionsSettingsSection } from "../../../pages/global-settings-page";
import { SettingsSectionBoundary } from "@/components/settings/settings-shared";

function SuggestionsRoute() {
  return (
    <SettingsSectionBoundary name="Suggestions">
      <SuggestionsSettingsSection />
    </SettingsSectionBoundary>
  );
}

export const Route = createFileRoute("/_app/settings/suggestions")({
  component: SuggestionsRoute,
});
