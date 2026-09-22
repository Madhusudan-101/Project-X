import { createFileRoute } from "@tanstack/react-router";
import { LiveActivityPage } from "@/components/admin/LiveActivityPage";

export const Route = createFileRoute("/admin/activity")({
  component: LiveActivityPage,
});
