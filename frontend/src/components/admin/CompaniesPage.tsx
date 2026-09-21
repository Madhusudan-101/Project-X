import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck } from "lucide-react";
import { adminTableQueryOptions } from "@/hooks/admin/query";
import { useAdminRange } from "@/hooks/admin/use-admin-range";
import { useTableState } from "@/hooks/admin/use-table-state";
import { adminService, type CompanyFilters } from "@/services/api/admin/admin";
import type { CompanyRow } from "@/types/admin/admin";
import { ActivityBadge, ExportButton, FilterSelect, PageHeader, SearchBox, Toolbar } from "./controls";
import { CompanyLink } from "./EntityLinks";
import { DataTable, type Column } from "./DataTable";
import { fmtDate, fmtInt, fmtRelative } from "./format";

const ACTIVITY_OPTIONS = [
  { value: "active", label: "Active in period" },
  { value: "inactive", label: "Inactive in period" },
];
const VERIFIED_OPTIONS = [
  { value: "yes", label: "Verified" },
  { value: "no", label: "Not verified" },
];

export function CompaniesPage() {
  const { range, label } = useAdminRange();
  const [activity, setActivity] = useState<CompanyFilters["activity"]>();
  const [verified, setVerified] = useState<string>();
  const t = useTableState({ sort: "applications", dir: "desc" }, [range, activity, verified]);

  const filters: CompanyFilters = { activity, verified: verified === undefined ? undefined : verified === "yes" };
  const q = useQuery({
    queryKey: ["admin", "companies", range, t.params, filters],
    queryFn: () => adminService.companies.list(range, { ...t.params, ...filters }),
    ...adminTableQueryOptions,
  });

  const columns: Column<CompanyRow>[] = [
    {
      key: "name",
      header: "Company",
      sortKey: "name",
      text: true,
      cell: (r) => (
        <div>
          <span className="inline-flex items-center gap-1">
            <CompanyLink id={r.company_id} name={r.name} />
            {r.is_verified && <BadgeCheck className="h-3.5 w-3.5 text-primary" aria-label="Verified company" />}
          </span>
          <div className="text-xs text-muted-foreground">{[r.industry, r.size].filter(Boolean).join(" · ")}</div>
        </div>
      ),
    },
    { key: "status", header: "Status", cell: (r) => <ActivityBadge active={r.is_active} /> },
    { key: "registered", header: "Registered", sortKey: "registered_at", cell: (r) => fmtDate(r.registered_at) },
    { key: "jobs", header: "Jobs", sortKey: "jobs", align: "right", cell: (r) => fmtInt(r.jobs) },
    { key: "drives", header: "Drives", sortKey: "drives", align: "right", cell: (r) => fmtInt(r.drives) },
    { key: "colleges", header: "Colleges", sortKey: "colleges", align: "right", cell: (r) => fmtInt(r.colleges) },
    { key: "applications", header: "Applications", sortKey: "applications", align: "right", cell: (r) => fmtInt(r.applications) },
    { key: "shortlisted", header: "Shortlisted", sortKey: "shortlisted", align: "right", cell: (r) => fmtInt(r.shortlisted) },
    { key: "selected", header: "Selected", sortKey: "selected", align: "right", cell: (r) => fmtInt(r.selected) },
    { key: "last", header: "Last activity", sortKey: "last_activity", cell: (r) => <span className="text-muted-foreground">{fmtRelative(r.last_activity)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Companies"
        description={
          <>
            Jobs, drives and colleges are all-time; applications, shortlisted and selected reflect the selected period (<span className="font-medium text-foreground">{label}</span>).
          </>
        }
        actions={
          <ExportButton
            onExport={() => adminService.companies.export(range, { search: t.params.search, sort: t.sort, dir: t.dir, ...filters })}
            filename="companies.csv"
          />
        }
      />
      <Toolbar>
        <SearchBox value={t.search} onChange={t.setSearch} placeholder="Search companies or industries" />
        <FilterSelect value={activity} onChange={(v) => setActivity(v as CompanyFilters["activity"])} options={ACTIVITY_OPTIONS} allLabel="Any activity" />
        <FilterSelect value={verified} onChange={setVerified} options={VERIFIED_OPTIONS} allLabel="Any verification" />
      </Toolbar>
      <DataTable
        label="Companies"
        columns={columns}
        rows={q.data?.items}
        rowKey={(r) => r.company_id}
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
          t.debouncedSearch || activity || verified
            ? { title: "No companies match these filters", hint: "Try clearing the search or filters." }
            : { title: "No companies have registered yet", hint: "Companies appear here once a recruiter signs up and creates a company profile." }
        }
      />
    </>
  );
}
