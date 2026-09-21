import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { adminQueryOptions, adminTableQueryOptions } from "@/hooks/admin/query";
import { useAdminRange } from "@/hooks/admin/use-admin-range";
import { useTableState } from "@/hooks/admin/use-table-state";
import { adminService, type CandidateFilters } from "@/services/api/admin/admin";
import type { CandidateRow } from "@/types/admin/admin";
import { BarList } from "./charts";
import { ExportButton, FilterSelect, PageHeader, SearchBox, StatusBadge, Toolbar } from "./controls";
import { PLACEMENT_STATUS } from "./status";
import { CollegeLink } from "./EntityLinks";
import { DataTable, type Column } from "./DataTable";
import { fmtDate, fmtInt } from "./format";
import { KpiCard, KpiGroup } from "./KpiCard";
import { ChartSkeleton, EmptyBlock, ErrorBlock } from "./StateViews";

const STATUS_OPTIONS = Object.entries(PLACEMENT_STATUS).map(([value, s]) => ({ value, label: s.label }));

/** Candidate analytics. Every count and status on a row is computed from the
 * same set of applications — those submitted in the date range, narrowed by
 * the company / drive filters — so a row never contradicts itself. */
export function CandidatesPage({ initial }: { initial?: { college?: string; company?: string; drive?: string } }) {
  const { range, label } = useAdminRange();
  const [college, setCollege] = useState(initial?.college);
  const [company, setCompany] = useState(initial?.company);
  const [drive, setDrive] = useState(initial?.drive);
  const [status, setStatus] = useState<string>();
  const [registeredInRange, setRegisteredInRange] = useState(false);
  const t = useTableState({ sort: "registered_at", dir: "desc" }, [range, college, company, drive, status, registeredInRange]);

  const filters: CandidateFilters = { college_id: college, company_id: company, drive_id: drive, status, registered_in_range: registeredInRange || undefined };

  const options = useQuery({ queryKey: ["admin", "options"], queryFn: adminService.options, ...adminQueryOptions, staleTime: 5 * 60_000 });
  const overview = useQuery({ queryKey: ["admin", "overview", range], queryFn: () => adminService.overview(range), ...adminQueryOptions });
  const byCollege = useQuery({
    queryKey: ["admin", "colleges", "by-candidates"],
    queryFn: () => adminService.colleges.list({}, { page: 1, page_size: 8, sort: "candidates", dir: "desc", registration: "all" }),
    ...adminQueryOptions,
  });
  const q = useQuery({
    queryKey: ["admin", "candidates", range, t.params, filters],
    queryFn: () => adminService.candidates.list(range, { ...t.params, ...filters }),
    ...adminTableQueryOptions,
  });

  const t0 = overview.data?.totals;
  const p = overview.data?.period;
  const driveOptions = [
    ...(options.data?.drives.map((d) => ({ value: d.id, label: d.label })) ?? []),
    ...(drive && !options.data?.drives.some((d) => d.id === drive) ? [{ value: drive, label: "Selected drive" }] : []),
  ];
  const distribution = (byCollege.data?.items ?? []).filter((c) => c.candidates > 0);

  const columns: Column<CandidateRow>[] = [
    {
      key: "name",
      header: "Candidate",
      sortKey: "name",
      text: true,
      cell: (r) => (
        <div>
          <div className="font-medium">{r.name}</div>
          <div className="text-xs text-muted-foreground">{r.email}</div>
        </div>
      ),
    },
    {
      key: "college",
      header: "College",
      sortKey: "college",
      text: true,
      cell: (r) => (r.college_id && r.college_name ? <CollegeLink id={r.college_id} name={r.college_name} /> : <span className="text-muted-foreground">Not set</span>),
    },
    { key: "branch", header: "Branch / batch", cell: (r) => <span className="text-muted-foreground">{[r.branch, r.graduation_year].filter(Boolean).join(" · ") || "—"}</span> },
    { key: "registered", header: "Registered", sortKey: "registered_at", cell: (r) => fmtDate(r.registered_at) },
    { key: "applications", header: "Applications", sortKey: "applications", align: "right", cell: (r) => fmtInt(r.applications) },
    { key: "shortlisted", header: "Shortlisted", sortKey: "shortlisted", align: "right", cell: (r) => fmtInt(r.shortlisted) },
    { key: "selected", header: "Selected", sortKey: "selected", align: "right", cell: (r) => fmtInt(r.selected) },
    {
      key: "status",
      header: "Placement status",
      cell: (r) => <StatusBadge tone={PLACEMENT_STATUS[r.placement_status].tone}>{PLACEMENT_STATUS[r.placement_status].label}</StatusBadge>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Candidates"
        description={
          <>
            Applications, shortlists and selections below cover applications submitted in the selected period (<span className="font-medium text-foreground">{label}</span>), narrowed by any company or drive filter. Placement status comes from platform applications only (a company selecting the candidate), not from any College Portal roster.
          </>
        }
        actions={
          <ExportButton onExport={() => adminService.candidates.export(range, { search: t.params.search, sort: t.sort, dir: t.dir, ...filters })} filename="candidates.csv" />
        }
      />

      <KpiGroup title="Candidates">
        <KpiCard label="Total candidates" loading={overview.isLoading} value={fmtInt(t0?.candidates)} />
        <KpiCard label="Registered in period" loading={overview.isLoading} value={fmtInt(p?.new_candidates)} />
        <KpiCard label="Active in period" loading={overview.isLoading} value={fmtInt(p?.active_candidates)} definition="Applied to a job or completed an AI practice interview in the period." />
        <KpiCard label="Selected in period" loading={overview.isLoading} value={fmtInt(p?.selected_applicants)} sub={p && `of ${fmtInt(p.applicants)} who applied`} />
      </KpiGroup>

      <Card className="p-5">
        <h2 className="font-display text-lg font-semibold">Where candidates come from</h2>
        <p className="mb-3 text-xs text-muted-foreground">Colleges with the most registered candidates (all-time).</p>
        {byCollege.isLoading ? (
          <ChartSkeleton className="h-32" />
        ) : byCollege.isError ? (
          <ErrorBlock error={byCollege.error} onRetry={() => byCollege.refetch()} />
        ) : distribution.length === 0 ? (
          <EmptyBlock title="No candidates have linked a college yet" />
        ) : (
          <BarList items={distribution.map((c) => ({ key: c.college_id, label: c.name, value: c.candidates }))} />
        )}
      </Card>

      <Toolbar>
        <SearchBox value={t.search} onChange={t.setSearch} placeholder="Search name or email" />
        <FilterSelect value={college} onChange={setCollege} options={(options.data?.colleges ?? []).map((c) => ({ value: c.id, label: c.name }))} allLabel="All colleges" />
        <FilterSelect value={company} onChange={setCompany} options={(options.data?.companies ?? []).map((c) => ({ value: c.id, label: c.name }))} allLabel="All companies" />
        <FilterSelect value={drive} onChange={setDrive} options={driveOptions} allLabel="All drives" className="w-full sm:w-56" />
        <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} allLabel="Any status" className="w-full sm:w-40" />
        <div className="flex items-center gap-2">
          <Checkbox id="reg-in-range" checked={registeredInRange} onCheckedChange={(v) => setRegisteredInRange(v === true)} />
          <Label htmlFor="reg-in-range" className="text-sm font-normal">
            Registered in the selected period
          </Label>
        </div>
      </Toolbar>
      {options.isError && <p role="alert" className="text-xs text-destructive">Filter lists couldn&apos;t be loaded; search still works.</p>}

      <DataTable
        label="Candidates"
        columns={columns}
        rows={q.data?.items}
        rowKey={(r) => r.candidate_id}
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
          t.debouncedSearch || college || company || drive || status || registeredInRange
            ? { title: "No candidates match these filters", hint: "Try widening the date range or clearing filters." }
            : { title: "No candidates have registered yet", hint: "Candidates appear here once they sign up." }
        }
      />
    </>
  );
}
