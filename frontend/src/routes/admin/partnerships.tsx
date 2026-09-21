import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/admin/controls";
import { PartnershipsTable } from "@/components/admin/PartnershipsTable";
import { useAdminRange } from "@/hooks/admin/use-admin-range";

export const Route = createFileRoute("/admin/partnerships")({
  component: PartnershipsPage,
});

function PartnershipsPage() {
  const { label } = useAdminRange();
  return (
    <>
      <PageHeader
        title="Company ↔ college partnerships"
        description={
          <>
            Which companies run drives at which colleges. A partnership exists only where a drive does; drives are all-time, applications, shortlisted and selected reflect the selected period (<span className="font-medium text-foreground">{label}</span>).
          </>
        }
      />
      <PartnershipsTable />
    </>
  );
}
