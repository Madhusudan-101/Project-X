import { createFileRoute } from "@tanstack/react-router";
import { AdminPortalLayout } from "@/components/admin/AdminPortalLayout";
import { redirectIfSignedOut } from "@/hooks/admin/use-admin-guard";

export const Route = createFileRoute("/super-admin")({
  beforeLoad: redirectIfSignedOut,
  head: () => ({ meta: [{ title: "Super Admin Portal — Mirracle" }] }),
  component: () => <AdminPortalLayout portal="super-admin" />,
});
