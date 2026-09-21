import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { adminTableQueryOptions } from "@/hooks/admin/query";
import { useAdminRange } from "@/hooks/admin/use-admin-range";
import { useTableState } from "@/hooks/admin/use-table-state";
import { adminService, type DriveFilters } from "@/services/api/admin/admin";
import type { DriveRow } from "@/types/admin/admin";
import { ExportButton, FilterSelect, SearchBox, StatusBadge, Toolbar } from "./controls";
import { DRIVE_STATUS } from "./status";
import { CollegeLink, CompanyLink } from "./EntityLinks";
import { DataTable, type Column } from "./DataTable";
import { fmtDate, fmtInt } from "./format";

const STATUS_OPTIONS = Object.entries(DRIVE_STATUS).map(([value, s]) => ({ value, label: s.label }));

/** Drive-wise performance. A drive is one company's job at one college; it is
 * listed if created in the date range or if it received applications in it. */
export function DrivesTable({ companyId, collegeId }: { companyId?: string; collegeId?: string }) {
  const { range } = useAdminRange();
  const [status, setStatus] = useState<string>();
  const t = useTableState({ sort: "applications", dir: "desc" }, [range, status, companyId, collegeId]);
  const filters: DriveFilters = { status, company_id: companyId, college_id: collegeId };

  const q = useQuery({
    queryKey: ["admin", "drives", range, t.params, filters],
    queryFn: () => adminService.drives.list(range, { ...t.params, ...filters }),
    ...adminTableQueryOptions,
  });

  const columns: Column<DriveRow>[] = [
    { key: "job", header: "Role", sortKey: "job", text: true, cell: (r) => <span className="font-medium">{r.job_title}</span> },
    ...(companyId ? [] : [{ key: "company", header: "Company", sortKey: "company", text: true, cell: (r: DriveRow) => <CompanyLink id={r.company_id} name={r.company_name} /> }]),
    ...(collegeId ? [] : [{ key: "college", header: "College", sortKey: "college", text: true, cell: (r: DriveRow) => <CollegeLink id={r.college_id} name={r.college_name} /> }]),
    {
      key: "status",
      header: "Status",
      cell: (r) => <StatusBadge tone={DRIVE_STATUS[r.status]?.tone ?? "muted"}>{DRIVE_STATUS[r.status]?.label ?? r.status}</StatusBadge>,
    },
    { key: "deadline", header: "Apply by", sortKey: "apply_deadline", cell: (r) => fmtDate(r.apply_deadline) },
    { key: "applications", header: "Applications", sortKey: "applications", align: "right", cell: (r) => fmtInt(r.applications) },
    { key: "shortlisted", header: "Shortlisted", sortKey: "shortlisted", align: "right", cell: (r) => fmtInt(r.shortlisted) },
    { key: "selected", header: "Selected", sortKey: "selected", align: "right", cell: (r) => fmtInt(r.selected) },
    {
      key: "candidates",
      header: "Candidates",
      hideHeader: true,
      align: "right",
      cell: (r) =>
        r.applications > 0 ? (
          <Link to="/admin/candidates" search={{ drive: r.drive_id }} className="text-xs text-primary hover:underline">
            View candidates
          </Link>
        ) : null,
    },
  ];

  return (
    <div className="space-y-3">
      <Toolbar>
        <SearchBox value={t.search} onChange={t.setSearch} placeholder="Search role, company or college" />
        <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} allLabel="Any status" className="w-full sm:w-36" />
        <div className="ml-auto">
          <ExportButton onExport={() => adminService.drives.export(range, { search: t.params.search, sort: t.sort, dir: t.dir, ...filters })} filename="drives.csv" />
        </div>
      </Toolbar>
      <DataTable
        label="Drive performance"
        columns={columns}
        rows={q.data?.items}
        rowKey={(r) => r.drive_id}
        loading={q.isLoading}
        fetching={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        sort={t.sort}
        dir={t.dir}
        onSort={t.toggleSort}
        page={t.page}
        pageSize={t.params.page_size}
        total={q.data?.total ?? 0}
        onPage={t.setPage}
        empty={
          t.debouncedSearch || status
            ? { title: "No drives match these filters" }
            : { title: "No drive activity in this period", hint: "Drives appear when they are created or receive applications within the selected dates." }
        }
      />
    </div>
  );
}
