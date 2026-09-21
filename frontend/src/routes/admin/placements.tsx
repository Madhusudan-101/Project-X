import { createFileRoute } from "@tanstack/react-router";
import { PlacementsPage } from "@/components/admin/PlacementsPage";

export const Route = createFileRoute("/admin/placements")({
  component: PlacementsPage,
});
