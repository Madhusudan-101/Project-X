import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { adminQueryOptions, adminTableQueryOptions } from "@/hooks/admin/query";
import { useAdminRange } from "@/hooks/admin/use-admin-range";
import { useTableState } from "@/hooks/admin/use-table-state";
import { adminService, type CollegeFilters } from "@/services/api/admin/admin";
import type { CollegeRow } from "@/types/admin/admin";
import { AddCollegeDialog } from "./AddCollegeDialog";
import { ActivityBadge, ExportButton, FilterSelect, PageHeader, SearchBox, StatusBadge, Toolbar } from "./controls";
import { CollegeLink } from "./EntityLinks";
import { DataTable, type Column } from "./DataTable";
import { fmtDate, fmtInt, fmtPct, fmtRelative, placementRate } from "./format";

const REGISTRATION_OPTIONS = [
  { value: "directory", label: "Directory only (no account)" },
  { value: "all", label: "All colleges" },
];
const ACTIVITY_OPTIONS = [
  { value: "active", label: "Active in period" },
  { value: "inactive", label: "Inactive in period" },
];

export function CollegesPage() {
  const { range, label } = useAdminRange();
  const [registration, setRegistration] = useState<CollegeFilters["registration"]>();
  const [activity, setActivity] = useState<CollegeFilters["activity"]>();
  const [adding, setAdding] = useState(false);
  const t = useTableState({ sort: "applications", dir: "desc" }, [range, registration, activity]);

  const filters: CollegeFilters = { registration: registration ?? "registered", activity };
  // The platform totals (all colleges) — to say plainly what this registered-only table leaves out.
  const overview = useQuery({ queryKey: ["admin", "overview", range], queryFn: () => adminService.overview(range), ...adminQueryOptions });
  const gapApplications = overview.data ? overview.data.period.applications - overview.data.period.applications_at_registered_colleges : 0;
  const gapDrives = overview.data ? overview.data.totals.drives - overview.data.totals.drives_at_registered_colleges : 0;
  const q = useQuery({
    queryKey: ["admin", "colleges", range, t.params, filters],
    queryFn: () => adminService.colleges.list(range, { ...t.params, ...filters }),
    ...adminTableQueryOptions,
  });

  const columns: Column<CollegeRow>[] = [
    {
      key: "name",
      header: "College",
      sortKey: "name",
      text: true,
      cell: (r) => (
        <div>
          <CollegeLink id={r.college_id} name={r.name} />
          {(r.city || r.state) && <div className="text-xs text-muted-foreground">{[r.city, r.state].filter(Boolean).join(", ")}</div>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (r.has_account ? <ActivityBadge active={r.is_active} /> : <StatusBadge tone="outline">No account</StatusBadge>),
    },
    { key: "registered", header: "Registered", sortKey: "registered_at", cell: (r) => (r.registered_at ? fmtDate(r.registered_at) : "—") },
    { key: "candidates", header: "Candidates on Platform", sortKey: "candidates", align: "right", cell: (r) => fmtInt(r.candidates) },
    { key: "companies", header: "Companies", sortKey: "companies", align: "right", cell: (r) => fmtInt(r.companies) },
    { key: "drives", header: "Company drives", sortKey: "drives", align: "right", cell: (r) => fmtInt(r.drives) },
    { key: "applications", header: "Applications", sortKey: "applications", align: "right", cell: (r) => fmtInt(r.applications) },
    { key: "shortlisted", header: "Shortlisted", sortKey: "shortlisted", align: "right", cell: (r) => fmtInt(r.shortlisted) },
    { key: "selected", header: "Selected", sortKey: "selected", align: "right", cell: (r) => fmtInt(r.selected) },
    { key: "rate", header: "Platform placement rate", sortKey: "placement_rate", align: "right", cell: (r) => fmtPct(placementRate(r)) },
    { key: "last", header: "Last activity", sortKey: "last_activity", cell: (r) => <span className="text-muted-foreground">{fmtRelative(r.last_activity)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Colleges"
        description={
          <>
            Colleges that have a College account. Candidates on Platform, companies and company drives are all-time platform data; applications, shortlisted, selected and placement rate cover the selected period (<span className="font-medium text-foreground">{label}</span>). Each college&apos;s own roster and Campus Drives (College Portal data) are separate and shown on its page.
          </>
        }
        actions={
          <>
            <ExportButton onExport={() => adminService.colleges.export(range, { search: t.params.search, sort: t.sort, dir: t.dir, ...filters })} filename="colleges.csv" />
            <Button size="sm" onClick={() => setAdding(true)} className="bg-gradient-brand text-primary-foreground">
              <Plus className="mr-2 h-4 w-4" /> Add college
            </Button>
          </>
        }
      />

      {!registration && (gapApplications > 0 || gapDrives > 0) && (
        <Card className="flex gap-3 border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p>
            This table lists <span className="font-medium text-foreground">registered colleges only</span>. The platform totals on the Overview also include{" "}
            <span className="font-medium text-foreground">{gapApplications.toLocaleString("en-IN")} application{gapApplications === 1 ? "" : "s"}</span> and{" "}
            <span className="font-medium text-foreground">{gapDrives.toLocaleString("en-IN")} company drive{gapDrives === 1 ? "" : "s"}</span> at colleges with no College account (or candidates with no college). Choose “Directory only” to see the colleges among them.
          </p>
        </Card>
      )}

      <Toolbar>
        <SearchBox value={t.search} onChange={t.setSearch} placeholder="Search colleges or cities" />
        <FilterSelect value={registration === "registered" ? undefined : registration} onChange={(v) => setRegistration(v as CollegeFilters["registration"])} options={REGISTRATION_OPTIONS} allLabel="Registered colleges" />
        <FilterSelect value={activity} onChange={(v) => setActivity(v as CollegeFilters["activity"])} options={ACTIVITY_OPTIONS} allLabel="Any activity" />
      </Toolbar>

      <DataTable
        label="Colleges"
        columns={columns}
        rows={q.data?.items}
        rowKey={(r) => r.college_id}
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
          t.debouncedSearch || activity || registration
            ? { title: "No colleges match these filters", hint: "Try clearing the search or filters." }
            : { title: "No colleges have been onboarded yet", hint: "Add a college to create its College account and give it access to the College Portal." }
        }
      />

      <AddCollegeDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}
