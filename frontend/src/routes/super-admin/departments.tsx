import { createFileRoute } from "@tanstack/react-router";
import { DepartmentsPage } from "@/components/admin/DepartmentsPage";

export const Route = createFileRoute("/super-admin/departments")({
  component: DepartmentsPage,
});
