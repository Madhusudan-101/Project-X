import { createFileRoute } from "@tanstack/react-router";
import { DashboardTab } from "@/components/college/DashboardTab";

export const Route = createFileRoute("/college/analytics")({
  component: AnalyticsPage,
});

function AnalyticsPage() {
  return <DashboardTab />;
}
