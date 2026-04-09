import { createFileRoute } from "@tanstack/react-router";
import {
  GeneralSettingsSection,
  InstructionsSettingsSection,
} from "../../../pages/global-settings-page";

function GeneralRoute() {
  return (
    <div className="space-y-10">
      <GeneralSettingsSection />
      <InstructionsSettingsSection />
    </div>
  );
}

export const Route = createFileRoute("/_app/settings/general")({
  component: GeneralRoute,
});
