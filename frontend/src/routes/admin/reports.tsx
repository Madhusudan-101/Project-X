import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage } from "@/components/admin/ReportsPage";

export const Route = createFileRoute("/admin/reports")({
  component: ReportsPage,
});
