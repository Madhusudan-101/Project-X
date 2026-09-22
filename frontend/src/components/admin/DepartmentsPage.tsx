import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { adminQueryOptions } from "@/hooks/admin/query";
import { useAdminRange } from "@/hooks/admin/use-admin-range";
import { adminService } from "@/services/api/admin/admin";
import type { DepartmentRow } from "@/types/admin/admin";
import { BarList } from "./charts";
import { DataTable, type Column } from "./DataTable";
import { FilterSelect, PageHeader, Toolbar } from "./controls";
import { fmtInt, fmtPct, placementRate } from "./format";
import { ChartSkeleton, EmptyBlock, ErrorBlock } from "./StateViews";

/** Candidates grouped by the branch text they entered themselves — not
 * resolved through the College Portal's branch-alias table, and not the
 * same `departments` a college manages on its own roster (that table has
 * no platform-wide equivalent). See the backend function's docstring. */
export function DepartmentsPage() {
  const { range, label } = useAdminRange();
  const [collegeId, setCollegeId] = useState<string>();
  const options = useQuery({ queryKey: ["admin", "options"], queryFn: adminService.options, ...adminQueryOptions, staleTime: 5 * 60_000 });
  const q = useQuery({
    queryKey: ["admin", "departments", range, collegeId],
    queryFn: () => adminService.departments(range, collegeId),
    ...adminQueryOptions,
  });

  const rows = q.data?.items ?? [];
  const distribution = rows.filter((r) => r.candidates > 0);

  const columns: Column<DepartmentRow>[] = [
    { key: "branch", header: "Branch", cell: (r) => <span className="font-medium">{r.branch}</span> },
    { key: "candidates", header: "Candidates", align: "right", cell: (r) => fmtInt(r.candidates) },
    { key: "applications", header: "Applications", align: "right", cell: (r) => fmtInt(r.applications) },
    { key: "shortlisted", header: "Shortlisted", align: "right", cell: (r) => fmtInt(r.shortlisted) },
    { key: "selected", header: "Selected", align: "right", cell: (r) => fmtInt(r.selected) },
    { key: "rate", header: "Placement rate", align: "right", cell: (r) => fmtPct(placementRate(r)) },
  ];

  return (
    <>
      <PageHeader
        title="Department analytics"
        description={
          <>
            Candidates grouped by the branch they entered on their profile, for applications submitted in{" "}
            <span className="font-medium text-foreground">{label}</span>. Branch text is shown as entered (e.g. &ldquo;CSE&rdquo; and
            &ldquo;Computer Science and Engineering&rdquo; are separate rows) — it is not resolved through any alias table.
          </>
        }
      />

      <Toolbar>
        <FilterSelect value={collegeId} onChange={setCollegeId} options={(options.data?.colleges ?? []).map((c) => ({ value: c.id, label: c.name }))} allLabel="All colleges" />
      </Toolbar>

      <Card className="p-5">
        <h2 className="font-display text-lg font-semibold">Candidates by branch</h2>
        <p className="mb-3 text-xs text-muted-foreground">All-time candidate counts, regardless of the date filter above.</p>
        {q.isLoading ? (
          <ChartSkeleton className="h-40" />
        ) : q.isError ? (
          <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
        ) : distribution.length === 0 ? (
          <EmptyBlock title="No candidates with a branch set" />
        ) : (
          <BarList items={distribution.map((r) => ({ key: r.branch, label: r.branch, value: r.candidates }))} />
        )}
      </Card>

      <DataTable
        label="Departments"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.branch}
        loading={q.isLoading}
        fetching={q.isFetching}
        error={q.error}
        onRetry={() => q.refetch()}
        sort="candidates"
        dir="desc"
        onSort={() => {}}
        page={1}
        pageSize={rows.length || 1}
        total={rows.length}
        onPage={() => {}}
        empty={{ title: "No branch data yet" }}
      />
    </>
  );
}
