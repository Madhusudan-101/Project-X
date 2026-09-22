import { createFileRoute } from "@tanstack/react-router";
import { SystemHealthPage } from "@/components/admin/SystemHealthPage";

export const Route = createFileRoute("/admin/system-health")({
  component: SystemHealthPage,
});
