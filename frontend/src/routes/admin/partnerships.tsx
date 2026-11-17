import { createFileRoute } from "@tanstack/react-router";
import { PartnershipsPage } from "@/components/admin/PartnershipsPage";

export const Route = createFileRoute("/admin/partnerships")({
  component: PartnershipsPage,
});
