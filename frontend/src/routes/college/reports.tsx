import { createFileRoute } from "@tanstack/react-router";
import { ReportsTab } from "@/components/college/ReportsTab";

export const Route = createFileRoute("/college/reports")({
  component: ReportsPage,
});

function ReportsPage() {
  return <ReportsTab />;
}
