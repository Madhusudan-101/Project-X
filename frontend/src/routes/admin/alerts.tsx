import { createFileRoute } from "@tanstack/react-router";
import { AlertsPage } from "@/components/admin/AlertsPage";

export const Route = createFileRoute("/admin/alerts")({
  component: AlertsPage,
});
