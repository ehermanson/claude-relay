import { createFileRoute } from "@tanstack/react-router";
import {
  GeneralSettingsSection,
  InstructionsSettingsSection,
} from "../../../pages/global-settings-page";
import { SettingsSectionBoundary } from "@/components/settings/settings-shared";

function GeneralRoute() {
  return (
    <div className="space-y-10">
      <SettingsSectionBoundary name="General">
        <GeneralSettingsSection />
      </SettingsSectionBoundary>
      <SettingsSectionBoundary name="Global Instructions">
        <InstructionsSettingsSection />
      </SettingsSectionBoundary>
    </div>
  );
}

export const Route = createFileRoute("/_app/settings/general")({
  component: GeneralRoute,
});
