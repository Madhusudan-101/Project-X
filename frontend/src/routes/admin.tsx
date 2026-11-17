import { createFileRoute } from "@tanstack/react-router";
import { AdminPortalLayout } from "@/components/admin/AdminPortalLayout";
import { redirectIfSignedOut } from "@/hooks/admin/use-admin-guard";

export const Route = createFileRoute("/admin")({
  beforeLoad: redirectIfSignedOut,
  component: () => <AdminPortalLayout portal="admin" />,
});
