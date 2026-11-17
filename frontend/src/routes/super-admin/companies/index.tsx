import { createFileRoute } from "@tanstack/react-router";
import { CompaniesPage } from "@/components/admin/CompaniesPage";

export const Route = createFileRoute("/super-admin/companies/")({
  component: CompaniesPage,
});
