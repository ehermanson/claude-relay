import { createFileRoute } from "@tanstack/react-router";
import { GitSettingsSection } from "../../../pages/global-settings-page";
import { SettingsSectionBoundary } from "@/components/settings/settings-shared";

function GitRoute() {
  return (
    <SettingsSectionBoundary name="Git">
      <GitSettingsSection />
    </SettingsSectionBoundary>
  );
}

export const Route = createFileRoute("/_app/settings/git")({
  component: GitRoute,
});
