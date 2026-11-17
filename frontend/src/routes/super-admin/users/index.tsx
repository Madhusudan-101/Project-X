import { createFileRoute } from "@tanstack/react-router";
import { UsersPage } from "@/components/admin/UsersPage";

export const Route = createFileRoute("/super-admin/users/")({
  component: UsersPage,
});
