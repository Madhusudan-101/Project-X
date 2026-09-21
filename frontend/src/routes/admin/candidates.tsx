import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CandidatesPage } from "@/components/admin/CandidatesPage";

const searchSchema = z.object({
  college: z.string().optional(),
  company: z.string().optional(),
  drive: z.string().optional(),
});

export const Route = createFileRoute("/admin/candidates")({
  validateSearch: (search) => searchSchema.parse(search),
  component: CandidatesRoute,
});

function CandidatesRoute() {
  const search = Route.useSearch();
  // Remount when a deep link (e.g. "View candidates" on a drive) changes the filters.
  return <CandidatesPage key={JSON.stringify(search)} initial={search} />;
}
