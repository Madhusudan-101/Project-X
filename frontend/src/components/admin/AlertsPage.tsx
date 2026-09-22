import { AlertsPanel } from "./AlertsPanel";
import { PageHeader } from "./controls";

export function AlertsPage() {
  return (
    <>
      <PageHeader
        title="Alerts"
        description="Conditions worth an Admin's attention, computed live from current data: drives with no applications, drives closing soon, incomplete college onboarding, incomplete candidate profiles, and blocked-account login attempts."
      />
      <AlertsPanel linkToAll={false} />
    </>
  );
}
