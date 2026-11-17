import { createFileRoute } from "@tanstack/react-router";
import { PartnershipsPage } from "@/components/admin/PartnershipsPage";

export const Route = createFileRoute("/super-admin/partnerships")({
  component: PartnershipsPage,
});
