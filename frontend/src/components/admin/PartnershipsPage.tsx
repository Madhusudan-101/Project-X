import { useAdminRange } from "@/hooks/admin/use-admin-range";
import { PageHeader } from "./controls";
import { PartnershipsTable } from "./PartnershipsTable";

export function PartnershipsPage() {
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
