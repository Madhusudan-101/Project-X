import { useState, type ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { formatDistanceToNow, parseISO } from "date-fns";
import {
  Activity,
  Award,
  BarChart3,
  Briefcase,
  Building2,
  CalendarPlus,
  FileCheck2,
  GraduationCap,
  ListChecks,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { adminQueryOptions } from "@/hooks/admin/query";
import { useAdminRange } from "@/hooks/admin/use-admin-range";
import { adminService } from "@/services/api/admin/admin";
import type { ActivityKind, TrendPoint, TrendResponse } from "@/types/admin/admin";
import { SERIES, TrendChart } from "./charts";
import { PageHeader } from "./controls";
import { fmtDecimal, fmtInt, fmtPct } from "./format";
import { KpiCard, KpiGroup } from "./KpiCard";
import { ChartSkeleton, EmptyBlock, ErrorBlock } from "./StateViews";

const REGISTRATION_TABS = [
  { value: "new_candidates", label: "Candidates", color: SERIES.indigo },
  { value: "new_companies", label: "Companies", color: SERIES.cyan },
  { value: "new_colleges", label: "Colleges", color: SERIES.amber },
] as const;

const ACTIVITY: Record<ActivityKind, { icon: LucideIcon; text: (subject: string, detail: string | null) => string }> = {
  candidate_registered: { icon: UserPlus, text: (s) => `${s} registered as a candidate` },
  company_registered: { icon: Building2, text: (s, d) => `${s} joined${d ? ` (${d})` : ""}` },
  college_registered: { icon: GraduationCap, text: (s) => `${s} was onboarded as a college` },
  drive_created: { icon: CalendarPlus, text: (s, d) => `${s} opened a drive: ${d}` },
  application_submitted: { icon: FileCheck2, text: (s, d) => `Application submitted to ${s}${d ? ` — ${d}` : ""}` },
  candidate_selected: { icon: Award, text: (s, d) => `A candidate was selected at ${s}${d ? ` — ${d}` : ""}` },
};

export function OverviewPage() {
  const { range, label } = useAdminRange();
  const [regTab, setRegTab] = useState<(typeof REGISTRATION_TABS)[number]["value"]>("new_candidates");

  const overview = useQuery({ queryKey: ["admin", "overview", range], queryFn: () => adminService.overview(range), ...adminQueryOptions });
  const trends = useQuery({ queryKey: ["admin", "trends", range], queryFn: () => adminService.trends(range), ...adminQueryOptions });
  const activity = useQuery({ queryKey: ["admin", "activity"], queryFn: () => adminService.activity(12), ...adminQueryOptions });

  const t = overview.data?.totals;
  const p = overview.data?.period;
  const d = overview.data?.derived;
  const loading = overview.isLoading;
  const activeUsers = p ? p.active_candidates + p.active_companies + p.active_colleges : null;
  const tab = REGISTRATION_TABS.find((x) => x.value === regTab)!;

  const header = (
    <PageHeader
      title="Platform overview"
      description={
        <>
          Showing <span className="font-medium text-foreground">{label}</span>. Totals are all-time; period figures follow the date filter.
        </>
      }
    />
  );

  // One clear error, not one per card, when the admin data itself can't be loaded
  // (e.g. a non-admin token, or the migration not applied yet).
  if (overview.isError) {
    return (
      <>
        {header}
        <ErrorBlock error={overview.error} onRetry={() => overview.refetch()} />
      </>
    );
  }

  return (
    <>
      {header}

      <>
          <KpiGroup title="Platform">
            <KpiCard
              label="Total users"
              icon={Users}
              loading={loading}
              value={fmtInt(t?.users)}
              sub={t && `${fmtInt(t.recruiters)} recruiters · ${fmtInt(t.college_accounts)} college · ${fmtInt(t.admins)} admin`}
              definition="Every account on the platform, all roles."
            />
            <KpiCard label="Candidates" icon={GraduationCap} loading={loading} value={fmtInt(t?.candidates)} sub={p && `+${fmtInt(p.new_candidates)} in period`} />
            <KpiCard
              label="Companies"
              icon={Building2}
              loading={loading}
              value={fmtInt(t?.companies)}
              sub={p && `+${fmtInt(p.new_companies)} in period`}
              definition="Registered company profiles. Recruiter accounts are counted in Total users."
            />
            <KpiCard
              label="Colleges"
              icon={GraduationCap}
              loading={loading}
              value={fmtInt(t?.colleges)}
              sub={t && `+${fmtInt(p?.new_colleges)} in period · ${fmtInt(Math.max(0, t.colleges_in_directory - t.colleges))} in directory, no account`}
              definition="Colleges that have a College account. The college directory also contains seeded colleges and ones candidates typed in; those are not counted here."
            />
          </KpiGroup>

          <KpiGroup title="Platform placement pipeline — all colleges, applications submitted in period" cols={5}>
            <KpiCard
              label="Company drives"
              icon={Briefcase}
              loading={loading}
              value={fmtInt(t?.drives)}
              sub={
                t && (
                  <>
                    <div>{fmtInt(t.drives_live)} live · {fmtInt(t.drives_draft)} draft · {fmtInt(t.drives_closed)} closed</div>
                    <div>{fmtInt(t.drives_at_registered_colleges)} at registered colleges</div>
                  </>
                )
              }
              definition="One company's job opened at one college on the platform, all-time, across ALL colleges (including ones without a College account). It does not include Campus Drives that a college's TPO enters in the College Portal."
            />
            <KpiCard
              label="Applications"
              icon={ListChecks}
              loading={loading}
              value={fmtInt(p?.applications)}
              sub={
                p && (
                  <>
                    <div>{fmtInt(p.applicants)} candidates applied</div>
                    <div>{fmtInt(p.applications_at_registered_colleges)} at registered colleges</div>
                  </>
                )
              }
              definition="Applications submitted in the period, from all candidates. 'At registered colleges' counts only students of colleges that have a College account, which is what the Colleges table lists."
            />
            <KpiCard
              label="Shortlisted"
              icon={ListChecks}
              loading={loading}
              value={fmtInt(p?.shortlisted)}
              sub={d && `${fmtPct(d.shortlist_rate)} of applications`}
              definition="Applications that a company shortlisted at any round, or that progressed to interview or selection."
            />
            <KpiCard label="Selected" icon={Award} loading={loading} value={fmtInt(p?.selected)} sub={p && `${fmtInt(p.selected_applicants)} candidate${p.selected_applicants === 1 ? "" : "s"}`} definition="Applications a company marked as hired." />
            <KpiCard
              label="Platform placement rate"
              icon={BarChart3}
              loading={loading}
              value={fmtPct(d?.placement_rate)}
              sub={p && `${fmtInt(p.selected_applicants)} of ${fmtInt(p.applicants)} applicants`}
              definition="Candidates a company selected ÷ candidates who applied on the platform, for applications submitted in the period. N/A when nobody applied. It is NOT the College Portal's placement percentage, which is the TPO's hand-marked placed students ÷ their roster."
            />
          </KpiGroup>

          <KpiGroup title="Engagement (activity in period)" cols={5}>
            <KpiCard
              label="Active users"
              icon={Activity}
              loading={loading}
              value={fmtInt(activeUsers)}
              sub="candidates + companies + colleges"
              definition="Candidates who applied or practised, companies that posted or decided, and colleges with drive, roster or student activity in the period. College activity is measured per college, not per login."
            />
            <KpiCard label="Active colleges" icon={GraduationCap} loading={loading} value={fmtInt(p?.active_colleges)} sub={d && `${fmtPct(d.college_participation)} of colleges have run a drive`} />
            <KpiCard label="Active companies" icon={Building2} loading={loading} value={fmtInt(p?.active_companies)} sub={d && `${fmtPct(d.company_participation)} of companies have run a drive`} />
            <KpiCard label="Active candidates" icon={Users} loading={loading} value={fmtInt(p?.active_candidates)} sub="applied or practised in period" />
            <KpiCard
              label="Applications per candidate"
              icon={ListChecks}
              loading={loading}
              value={fmtDecimal(d?.applications_per_applicant, 2)}
              sub={d && `${fmtDecimal(d.applications_per_drive, 2)} per drive`}
              definition="Applications ÷ candidates who applied; per drive counts only drives that received an application."
            />
          </KpiGroup>

          <KpiGroup title="Financial">
            <KpiCard label="Revenue" value={null} definition="No payment or subscription data exists yet." />
            <KpiCard label="Expenditure" value={null} definition="No expense data exists yet." />
            <KpiCard label="Net revenue" value={null} definition="Needs revenue and expenditure data." />
            <Card className="flex items-center p-4 text-xs text-muted-foreground">
              <span>
                Financial data isn&apos;t connected yet.{" "}
                <Link to="/admin/finance" className="font-medium text-primary hover:underline">
                  See what&apos;s needed
                </Link>
              </span>
            </Card>
          </KpiGroup>
      </>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-lg font-semibold">New registrations</h2>
              <p className="text-xs text-muted-foreground">How fast is each side of the platform growing?</p>
            </div>
            <Tabs value={regTab} onValueChange={(v) => setRegTab(v as typeof regTab)}>
              <TabsList>
                {REGISTRATION_TABS.map((x) => (
                  <TabsTrigger key={x.value} value={x.value}>
                    {x.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <TrendPanel query={trends} empty="No registrations in this period." hasData={(pts) => pts.some((x) => x[regTab] > 0)}>
            {(data) => <TrendChart points={data.points} bucket={data.bucket} series={[{ key: regTab, label: tab.label, color: tab.color }]} />}
          </TrendPanel>
        </Card>

        <Card className="p-5">
          <div className="mb-3">
            <h2 className="font-display text-lg font-semibold">Application pipeline</h2>
            <p className="text-xs text-muted-foreground">
              Applications submitted in each interval, and where they stand today.
            </p>
          </div>
          <TrendPanel query={trends} empty="No applications in this period." hasData={(pts) => pts.some((x) => x.applications > 0)}>
            {(data) => (
              <TrendChart
                points={data.points}
                bucket={data.bucket}
                series={[
                  { key: "applications", label: "Applications", color: SERIES.indigo },
                  { key: "shortlisted", label: "Shortlisted", color: SERIES.cyan },
                  { key: "selected", label: "Selected", color: SERIES.amber },
                ]}
              />
            )}
          </TrendPanel>
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-3">
          <h2 className="font-display text-lg font-semibold">Recent platform activity</h2>
          <p className="text-xs text-muted-foreground">Latest events across the platform, newest first. Independent of the date filter.</p>
        </div>
        {activity.isLoading ? (
          <ChartSkeleton className="h-40" />
        ) : activity.isError ? (
          <ErrorBlock error={activity.error} onRetry={() => activity.refetch()} />
        ) : activity.data?.items.length ? (
          <ul className="divide-y divide-border">
            {activity.data.items.map((a, i) => {
              const meta = ACTIVITY[a.kind];
              const Icon = meta.icon;
              return (
                <li key={`${a.kind}-${a.occurred_at}-${i}`} className="flex items-start gap-3 py-2.5 text-sm">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 break-words">{meta.text(a.subject, a.detail)}</span>
                  <time className="shrink-0 text-xs text-muted-foreground" dateTime={a.occurred_at}>
                    {formatDistanceToNow(parseISO(a.occurred_at), { addSuffix: true })}
                  </time>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyBlock title="No activity yet" hint="Events appear here as candidates, companies and colleges use the platform." />
        )}
      </Card>

      <details className="rounded-lg border border-border bg-card p-4 text-sm">
        <summary className="cursor-pointer font-medium">How these numbers are calculated</summary>
        <dl className="mt-3 grid gap-x-8 gap-y-2 text-xs text-muted-foreground md:grid-cols-2">
          <Def term="Colleges">Colleges with a College account, not every row in the college directory.</Def>
          <Def term="Platform vs College Portal">Everything here is the platform pipeline: companies open drives, candidates apply, companies shortlist and select. The College Portal&apos;s own roster, hand-marked placements and Campus Drives are a separate dataset (shown on each college&apos;s page); nothing syncs between the two.</Def>
          <Def term="All colleges vs registered colleges">Overview totals include drives and applications at colleges with no College account, and candidates with no college. The Colleges table lists registered colleges only; the gap is stated under the totals and above that table.</Def>
          <Def term="Period metrics">Applications are counted by submission date; registrations and drives by creation date. Totals are all-time.</Def>
          <Def term="Shortlisted / Selected">Shortlisted at any round (or progressed further), even if rejected later / marked hired by the company. Each is a subset of the one before it.</Def>
          <Def term="Placement rate">Distinct candidates selected ÷ distinct candidates who applied, for applications in the period.</Def>
          <Def term="Active">Produced at least one timestamped event in the period (applying, practising, posting, deciding, roster or drive changes). There is no separate login log.</Def>
          <Def term="N/A">Shown when a figure cannot be calculated (for example a rate with nobody in the denominator). Never a made-up 0.</Def>
        </dl>
      </details>
    </>
  );
}

function Def({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-foreground">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function TrendPanel({
  query,
  hasData,
  empty,
  children,
}: {
  query: UseQueryResult<TrendResponse, unknown>;
  hasData: (points: TrendPoint[]) => boolean;
  empty: string;
  children: (data: TrendResponse) => ReactNode;
}) {
  if (query.isLoading) return <ChartSkeleton />;
  if (query.isError) return <ErrorBlock error={query.error} onRetry={() => query.refetch()} />;
  if (!query.data || !hasData(query.data.points)) return <EmptyBlock title={empty} />;
  return <>{children(query.data)}</>;
}
