import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";
import { useAdminGuard } from "@/hooks/admin/use-admin-guard";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const session = useAdminGuard();
  if (!session) return null;
  return <AdminShell session={session} />;
}
