import { createFileRoute } from "@tanstack/react-router";
import { CandidatesPage, candidatesSearchSchema } from "@/components/admin/CandidatesPage";

export const Route = createFileRoute("/super-admin/candidates")({
  validateSearch: (search) => candidatesSearchSchema.parse(search),
  component: CandidatesRoute,
});

function CandidatesRoute() {
  const search = Route.useSearch();
  // Remount when a deep link (e.g. "View candidates" on a drive) changes the filters.
  return <CandidatesPage key={JSON.stringify(search)} initial={search} />;
}
