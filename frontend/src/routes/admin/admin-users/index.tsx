import { createFileRoute } from "@tanstack/react-router";
import { AdminManagementPage } from "@/components/admin/AdminManagementPage";

export const Route = createFileRoute("/admin/admin-users/")({
  component: AdminManagementPage,
});
