import { createFileRoute } from "@tanstack/react-router";
import { AdminManagementPage } from "@/components/admin/AdminManagementPage";

export const Route = createFileRoute("/super-admin/admin-users/")({
  component: AdminManagementPage,
});
