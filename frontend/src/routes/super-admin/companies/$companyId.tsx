import { createFileRoute } from "@tanstack/react-router";
import { CompanyDetailPage } from "@/components/admin/EntityDetail";

export const Route = createFileRoute("/super-admin/companies/$companyId")({
  component: CompanyRoute,
});

function CompanyRoute() {
  const { companyId } = Route.useParams();
  return <CompanyDetailPage companyId={companyId} />;
}
