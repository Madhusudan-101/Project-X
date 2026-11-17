import { createFileRoute } from "@tanstack/react-router";
import { LiveActivityPage } from "@/components/admin/LiveActivityPage";

export const Route = createFileRoute("/super-admin/activity")({
  component: LiveActivityPage,
});
