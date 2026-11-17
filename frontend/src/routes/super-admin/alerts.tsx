import { createFileRoute } from "@tanstack/react-router";
import { AlertsPage } from "@/components/admin/AlertsPage";

export const Route = createFileRoute("/super-admin/alerts")({
  component: AlertsPage,
});
