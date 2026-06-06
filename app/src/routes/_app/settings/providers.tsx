import { createFileRoute } from "@tanstack/react-router";
import { ProvidersSettingsSection } from "../../../pages/global-settings-page";
import { SettingsSectionBoundary } from "@/components/settings/settings-shared";

function ProvidersRoute() {
  return (
    <SettingsSectionBoundary name="Providers">
      <ProvidersSettingsSection />
    </SettingsSectionBoundary>
  );
}

export const Route = createFileRoute("/_app/settings/providers")({
  component: ProvidersRoute,
});
