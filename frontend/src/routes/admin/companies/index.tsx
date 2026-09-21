import { createFileRoute } from "@tanstack/react-router";
import { CompaniesPage } from "@/components/admin/CompaniesPage";

export const Route = createFileRoute("/admin/companies/")({
  component: CompaniesPage,
});
