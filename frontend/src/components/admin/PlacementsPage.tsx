import { useQuery } from "@tanstack/react-query";
import { Award, BarChart3, Briefcase, ListChecks } from "lucide-react";
import { Card } from "@/components/ui/card";
import { adminQueryOptions } from "@/hooks/admin/query";
import { useAdminRange } from "@/hooks/admin/use-admin-range";
import { adminService } from "@/services/api/admin/admin";
import type { CtcBlock } from "@/types/admin/admin";
import { BarList, ColumnChart, SERIES } from "./charts";
import { PageHeader, StatusBadge } from "./controls";
import { DRIVE_STATUS } from "./status";
import { DrivesTable } from "./DrivesTable";
import { fmtDecimal, fmtInr, fmtInt, fmtPct, placementRate, ratio } from "./format";
import { KpiCard, KpiGroup } from "./KpiCard";
import { ChartSkeleton, EmptyBlock, ErrorBlock } from "./StateViews";

export function PlacementsPage() {
  const { range, label } = useAdminRange();

  const summary = useQuery({ queryKey: ["admin", "placements", range], queryFn: () => adminService.placements(range), ...adminQueryOptions });
  const ctcByCompany = useQuery({ queryKey: ["admin", "ctc-by-company", range], queryFn: () => adminService.ctcByCompany(range), ...adminQueryOptions });
  const colleges = useQuery({
    queryKey: ["admin", "colleges", "top-applicants", range],
    queryFn: () => adminService.colleges.list(range, { page: 1, page_size: 8, sort: "applications", dir: "desc", registration: "registered" }),
    ...adminQueryOptions,
  });
  const companies = useQuery({
    queryKey: ["admin", "companies", "top-hiring", range],
    queryFn: () => adminService.companies.list(range, { page: 1, page_size: 8, sort: "selected", dir: "desc" }),
    ...adminQueryOptions,
  });

  const s = summary.data;
  const f = s?.funnel;
  const topColleges = (colleges.data?.items ?? []).filter((c) => c.applicants > 0);
  const topHirers = (companies.data?.items ?? []).filter((c) => c.selected > 0);

  return (
    <>
      <PageHeader
        title="Placement analytics"
        description={
          <>
            The platform pipeline: applications submitted in the selected period (<span className="font-medium text-foreground">{label}</span>) and where they stand today, across all colleges. Drive counts are all-time. This is not the College Portal&apos;s Campus Drives or roster placements, which are separate data.
          </>
        }
      />

      {summary.isError ? (
        <ErrorBlock error={summary.error} onRetry={() => summary.refetch()} />
      ) : (
        <>
          <KpiGroup title="Funnel" cols={5}>
            <KpiCard label="Company drives" icon={Briefcase} loading={summary.isLoading} value={fmtInt(s?.drives.total)} sub={s && `${fmtInt(s.drives.created_in_period)} created in period`} />
            <KpiCard label="Applications" icon={ListChecks} loading={summary.isLoading} value={fmtInt(f?.applications)} sub={f && `${fmtDecimal(f.applications_per_drive, 2)} per drive`} definition="Per drive that received at least one application." />
            <KpiCard label="Shortlisted" icon={ListChecks} loading={summary.isLoading} value={fmtInt(f?.shortlisted)} sub={f && `${fmtPct(f.shortlist_rate)} of applications`} />
            <KpiCard label="Selected" icon={Award} loading={summary.isLoading} value={fmtInt(f?.selected)} />
            <KpiCard label="Platform placement rate" icon={BarChart3} loading={summary.isLoading} value={fmtPct(f?.placement_rate)} sub={f && `${fmtInt(f.selected_applicants)} of ${fmtInt(f.applicants)} applicants`} definition="Distinct candidates a company selected ÷ distinct candidates who applied on the platform. Not the College Portal's TPO-marked placement percentage." />
          </KpiGroup>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="font-display text-lg font-semibold">Application funnel</h2>
              <p className="mb-3 text-xs text-muted-foreground">Each stage is a subset of the one above it.</p>
              {summary.isLoading ? (
                <ChartSkeleton className="h-32" />
              ) : !f || f.applications === 0 ? (
                <EmptyBlock title="No applications in this period" />
              ) : (
                <BarList
                  items={[
                    { key: "applied", label: "Applied", value: f.applications, display: fmtInt(f.applications) },
                    { key: "shortlisted", label: "Shortlisted", value: f.shortlisted, display: `${fmtInt(f.shortlisted)} · ${fmtPct(ratio(f.shortlisted, f.applications))}` },
                    { key: "selected", label: "Selected", value: f.selected, display: `${fmtInt(f.selected)} · ${fmtPct(ratio(f.selected, f.applications))}` },
                  ]}
                />
              )}
            </Card>

            <Card className="p-5">
              <h2 className="font-display text-lg font-semibold">Company drives by status</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                Live drives are open to students; draft drives are not yet published. Drives have no start date, so &ldquo;upcoming&rdquo; can&apos;t be derived.
              </p>
              {summary.isLoading ? (
                <ChartSkeleton className="h-24" />
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {(["live", "draft", "closed"] as const).map((k) => (
                    <div key={k} className="rounded-lg border border-border p-3">
                      <StatusBadge tone={DRIVE_STATUS[k].tone}>{DRIVE_STATUS[k].label}</StatusBadge>
                      <div className="mt-2 font-display text-2xl font-semibold tabular-nums">{fmtInt(s?.drives[k])}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card className="p-5">
            <h2 className="font-display text-lg font-semibold">Salary (CTC)</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              From the advertised CTC range on full-time and contract roles, using the midpoint of each range. No actual offered salary is stored. Internships (stipend) and non-INR roles are excluded
              {s && s.ctc.excluded_other_currency > 0 ? ` (${s.ctc.excluded_other_currency} non-INR role${s.ctc.excluded_other_currency === 1 ? "" : "s"} excluded)` : ""}.
            </p>
            {summary.isLoading ? (
              <ChartSkeleton className="h-48" />
            ) : s ? (
              <div className="grid gap-6 lg:grid-cols-2">
                <CtcPanel title="Roles posted in period" block={s.ctc.posted} color={SERIES.indigo} />
                <CtcPanel title="Roles where a candidate was selected" block={s.ctc.filled} color={SERIES.cyan} />
              </div>
            ) : null}
          </Card>

          <Card className="p-5">
            <h2 className="font-display text-lg font-semibold">CTC by company</h2>
            <p className="mb-3 text-xs text-muted-foreground">Posted (advertised) vs. filled (roles where a candidate was selected), per company. Same INR-only, no-actual-offer-stored caveat as above.</p>
            {ctcByCompany.isLoading ? (
              <ChartSkeleton className="h-32" />
            ) : ctcByCompany.isError ? (
              <ErrorBlock error={ctcByCompany.error} onRetry={() => ctcByCompany.refetch()} />
            ) : !ctcByCompany.data?.items.length ? (
              <EmptyBlock title="No CTC data by company in this period" />
            ) : (
              <BarList
                color={SERIES.amber}
                items={ctcByCompany.data.items.filter((c) => c.filled_roles > 0 || c.posted_roles > 0).map((c) => ({
                  key: c.company_id,
                  label: c.company_name,
                  value: c.filled_roles,
                  sub: `${fmtInt(c.posted_roles)} posted`,
                  display: `${fmtInt(c.filled_roles)} filled${c.filled_average ? ` · avg ${fmtInr(c.filled_average)}` : ""}`,
                }))}
              />
            )}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="font-display text-lg font-semibold">College placement comparison</h2>
              <p className="mb-3 text-xs text-muted-foreground">Colleges with the most applicants; bar = placement rate.</p>
              {colleges.isLoading ? (
                <ChartSkeleton className="h-40" />
              ) : colleges.isError ? (
                <ErrorBlock error={colleges.error} onRetry={() => colleges.refetch()} />
              ) : topColleges.length === 0 ? (
                <EmptyBlock title="No college has applicants in this period" />
              ) : (
                <BarList
                  max={1}
                  items={topColleges.map((c) => ({
                    key: c.college_id,
                    label: c.name,
                    value: placementRate(c) ?? 0,
                    display: `${fmtPct(placementRate(c))} · ${fmtInt(c.selected_applicants)} of ${fmtInt(c.applicants)}`,
                  }))}
                />
              )}
            </Card>

            <Card className="p-5">
              <h2 className="font-display text-lg font-semibold">Company hiring</h2>
              <p className="mb-3 text-xs text-muted-foreground">Companies with the most candidates selected.</p>
              {companies.isLoading ? (
                <ChartSkeleton className="h-40" />
              ) : companies.isError ? (
                <ErrorBlock error={companies.error} onRetry={() => companies.refetch()} />
              ) : topHirers.length === 0 ? (
                <EmptyBlock title="No candidates were selected in this period" />
              ) : (
                <BarList
                  color={SERIES.cyan}
                  items={topHirers.map((c) => ({ key: c.company_id, label: c.name, value: c.selected, sub: `${fmtInt(c.applications)} applications` }))}
                />
              )}
            </Card>
          </div>

          <Card className="p-5">
            <h2 className="font-display text-lg font-semibold">Company drive performance</h2>
            <p className="mb-3 text-xs text-muted-foreground">Drives created or applied to in the selected period.</p>
            <DrivesTable />
          </Card>
        </>
      )}
    </>
  );
}

function CtcPanel({ title, block, color }: { title: string; block: CtcBlock; color: string }) {
  if (block.roles === 0) {
    return (
      <div>
        <h3 className="mb-2 text-sm font-medium">{title}</h3>
        <EmptyBlock title="No CTC data" hint="No roles with a stated CTC in this period." />
      </div>
    );
  }
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium">
        {title} <span className="font-normal text-muted-foreground">· {fmtInt(block.roles)}</span>
      </h3>
      <dl className="mb-3 grid grid-cols-3 gap-2 text-center">
        {[
          ["Average", block.average],
          ["Highest", block.highest],
          ["Lowest", block.lowest],
        ].map(([k, v]) => (
          <div key={k as string} className="rounded-md border border-border p-2">
            <dt className="text-[11px] text-muted-foreground">{k}</dt>
            <dd className="font-display text-base font-semibold tabular-nums">{fmtInr(v as number | null)}</dd>
          </div>
        ))}
      </dl>
      <ColumnChart data={block.distribution} color={color} label={`${title}: CTC distribution`} />
    </div>
  );
}
