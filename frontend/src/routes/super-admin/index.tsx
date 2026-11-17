import { createFileRoute } from "@tanstack/react-router";
import { OverviewPage } from "@/components/admin/OverviewPage";

export const Route = createFileRoute("/super-admin/")({
  component: OverviewPage,
});
