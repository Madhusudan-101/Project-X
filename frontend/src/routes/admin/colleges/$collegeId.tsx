import { createFileRoute } from "@tanstack/react-router";
import { CollegeDetailPage } from "@/components/admin/EntityDetail";

export const Route = createFileRoute("/admin/colleges/$collegeId")({
  component: CollegeRoute,
});

function CollegeRoute() {
  const { collegeId } = Route.useParams();
  return <CollegeDetailPage collegeId={collegeId} />;
}
