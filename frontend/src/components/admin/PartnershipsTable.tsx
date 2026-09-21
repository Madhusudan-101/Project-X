import { useQuery } from "@tanstack/react-query";
import { adminTableQueryOptions } from "@/hooks/admin/query";
import { useAdminRange } from "@/hooks/admin/use-admin-range";
import { useTableState } from "@/hooks/admin/use-table-state";
import { adminService, type PartnershipFilters } from "@/services/api/admin/admin";
import type { PartnershipRow } from "@/types/admin/admin";
import { ExportButton, SearchBox, Toolbar } from "./controls";
import { CollegeLink, CompanyLink } from "./EntityLinks";
import { DataTable, type Column } from "./DataTable";
import { fmtDate, fmtInt } from "./format";

/** Company ↔ College partnerships. A pair exists only where the company has a
 * drive at that college. Scope it to one company or college with the props
 * (the corresponding column is then dropped as redundant). */
export function PartnershipsTable({ companyId, collegeId }: { companyId?: string; collegeId?: string }) {
  const { range } = useAdminRange();
  const t = useTableState({ sort: "applications", dir: "desc" }, [range, companyId, collegeId]);
  const filters: PartnershipFilters = { company_id: companyId, college_id: collegeId };

  const q = useQuery({
    queryKey: ["admin", "partnerships", range, t.params, filters],
    queryFn: () => adminService.partnerships.list(range, { ...t.params, ...filters }),
    ...adminTableQueryOptions,
  });

  const columns: Column<PartnershipRow>[] = [
    ...(companyId
      ? []
      : [{ key: "company", header: "Company", sortKey: "company", text: true, cell: (r: PartnershipRow) => <CompanyLink id={r.company_id} name={r.company_name} /> }]),
    ...(collegeId
      ? []
      : [{ key: "college", header: "College", sortKey: "college", text: true, cell: (r: PartnershipRow) => <CollegeLink id={r.college_id} name={r.college_name} /> }]),
    { key: "drives", header: "Company drives", sortKey: "drives", align: "right", cell: (r) => fmtInt(r.drives) },
    { key: "latest", header: "Latest drive", sortKey: "last_drive_at", cell: (r) => fmtDate(r.last_drive_at) },
    { key: "applications", header: "Applications", sortKey: "applications", align: "right", cell: (r) => fmtInt(r.applications) },
    { key: "shortlisted", header: "Shortlisted", sortKey: "shortlisted", align: "right", cell: (r) => fmtInt(r.shortlisted) },
    { key: "selected", header: "Selected", sortKey: "selected", align: "right", cell: (r) => fmtInt(r.selected) },
  ];

  return (
    <div className="space-y-3">
      <Toolbar>
        <SearchBox value={t.search} onChange={t.setSearch} placeholder="Search company or college" />
        <div className="ml-auto">
          <ExportButton
            onExport={() => adminService.partnerships.export(range, { search: t.params.search, sort: t.sort, dir: t.dir, ...filters })}
            filename="company_college_partnerships.csv"
          />
        </div>
      </Toolbar>
      <DataTable
        label="Company and college partnerships"
        columns={columns}
        rows={q.data?.items}
        rowKey={(r) => `${r.company_id}:${r.college_id}`}
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
          t.debouncedSearch
            ? { title: "No partnerships match this search" }
            : { title: "No company–college partnerships yet", hint: "A partnership appears once a company opens a drive at a college." }
        }
      />
    </div>
  );
}
