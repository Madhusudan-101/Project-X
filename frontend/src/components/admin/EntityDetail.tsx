import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, BadgeCheck, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { adminQueryOptions } from "@/hooks/admin/query";
import { useAdminRange } from "@/hooks/admin/use-admin-range";
import { adminService } from "@/services/api/admin/admin";
import { ApiClientError } from "@/services/api/client";
import type { CollegeRow, CompanyRow, FunnelCounts } from "@/types/admin/admin";
import { ActivityBadge, PageHeader, StatusBadge } from "./controls";
import { DrivesTable } from "./DrivesTable";
import { fmtDate, fmtInt, fmtPct, fmtRelative, placementRate } from "./format";
import { KpiCard, KpiGroup } from "./KpiCard";
import { PartnershipsTable } from "./PartnershipsTable";
import { ChartSkeleton, EmptyBlock, ErrorBlock } from "./StateViews";

function FunnelKpis({ r, loading }: { r?: FunnelCounts; loading: boolean }) {
  const rate = r ? placementRate(r) : null;
  return (
    <>
      <KpiCard label="Applications" loading={loading} value={fmtInt(r?.applications)} sub={r && `${fmtInt(r.applicants)} candidates`} />
      <KpiCard label="Shortlisted" loading={loading} value={fmtInt(r?.shortlisted)} definition="Shortlisted at any round, including candidates who were rejected later." />
      <KpiCard label="Selected" loading={loading} value={fmtInt(r?.selected)} sub={r && `${fmtInt(r.selected_applicants)} candidate${r.selected_applicants === 1 ? "" : "s"}`} definition="Applications a company marked as hired. One candidate hired by two companies is two selected applications but one selected candidate." />
      <KpiCard label="Platform placement rate" loading={loading} value={fmtPct(rate)} definition="Candidates selected by a company ÷ candidates who applied on the platform, in the selected period. Not the College Portal's placement percentage." />
    </>
  );
}

function BackLink({ to, label }: { to: "/admin/colleges" | "/admin/companies"; label: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> {label}
    </Link>
  );
}

function NotFound({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  return error instanceof ApiClientError && error.status === 404 ? (
    <EmptyBlock title={`${what} not found`} hint="It may have been removed, or the link is wrong." />
  ) : (
    <ErrorBlock error={error} onRetry={onRetry} />
  );
}

export function CollegeDetailPage({ collegeId }: { collegeId: string }) {
  const { range, label } = useAdminRange();
  const q = useQuery({
    queryKey: ["admin", "college", collegeId, range],
    queryFn: () => adminService.colleges.detail(collegeId, range),
    ...adminQueryOptions,
  });
  const c: CollegeRow | undefined = q.data?.college;

  return (
    <>
      <BackLink to="/admin/colleges" label="All colleges" />
      {q.isError ? (
        <NotFound what="College" error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <PageHeader
            title={c?.name ?? "College"}
            description={
              c && (
                <span className="flex flex-wrap items-center gap-2">
                  {[c.city, c.state].filter(Boolean).join(", ") || "Location not set"}
                  {c.has_account ? <ActivityBadge active={c.is_active} /> : <StatusBadge tone="outline">No account</StatusBadge>}
                  <span className="text-xs">
                    {c.registered_at ? `Registered ${fmtDate(c.registered_at)} · ` : ""}Last activity {fmtRelative(c.last_activity)}
                  </span>
                </span>
              )
            }
          />

          <KpiGroup title={`Platform pipeline — company drives → applications → selection (${label})`} cols={3}>
            <KpiCard label="Candidates on Platform" loading={q.isLoading} value={fmtInt(c?.candidates)} definition="Candidates who signed up on Mirracle and chose this college. Not the same as the roster the college uploaded." />
            <KpiCard label="Companies engaged" loading={q.isLoading} value={fmtInt(c?.companies)} sub="with a drive at this college (all-time)" />
            <KpiCard label="Company drives" loading={q.isLoading} value={fmtInt(c?.drives)} sub="opened by companies (all-time)" definition="A drive is one company's job opened at this college on the platform. It is not a Campus Drive entered in the College Portal." />
            <FunnelKpis r={c} loading={q.isLoading} />
          </KpiGroup>

          <KpiGroup title="College Portal data — entered by this college's TPO (all-time)" cols={3}>
            <KpiCard label="College roster students" loading={q.isLoading} value={fmtInt(c?.roster_students)} definition="Students the college uploaded to its own roster. They are not necessarily registered on the platform." />
            <KpiCard label="Roster students marked placed" loading={q.isLoading} value={fmtInt(c?.roster_placed)} sub="marked by the TPO, by hand" definition="Placement status the TPO set on the roster. It is not derived from company selections on the platform." />
            <KpiCard label="Campus Drives (College Portal)" loading={q.isLoading} value={fmtInt(c?.portal_drives)} sub="typed in by the TPO" definition="Campus Drives the TPO recorded in the College Portal. They are not platform drives and have no applications attached." />
          </KpiGroup>

          <Card className="flex gap-3 border-primary/30 bg-primary/5 p-4 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <div className="space-y-1.5">
              <p className="font-medium">Two separate datasets: do not expect these figures to match</p>
              <p className="text-xs text-muted-foreground">
                The <span className="font-medium text-foreground">platform pipeline</span> is what companies and candidates do on Mirracle: companies open drives at this college, candidates apply, companies shortlist and select.
                The <span className="font-medium text-foreground">College Portal data</span> is what the college&apos;s own TPO records: an uploaded roster, placement marked by hand, and Campus Drives entered manually.
                Nothing syncs between them. A Campus Drive or a &ldquo;placed&rdquo; student recorded in the College Portal does not appear in the platform numbers, and a company selecting a candidate does not update the roster.
              </p>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-display text-lg font-semibold">College accounts</h2>
            {q.isLoading ? (
              <ChartSkeleton className="h-16" />
            ) : q.data?.accounts.length ? (
              <ul className="divide-y divide-border text-sm">
                {q.data.accounts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium">{a.name || a.email}</span>
                      {a.name && <span className="ml-2 text-muted-foreground">{a.email}</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Joined {fmtDate(a.created_at)} · {a.onboarded ? "Onboarding complete" : "Onboarding pending"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyBlock title="No College account yet" hint="This college is a directory entry. Use “Add college” to create an account for its placement contact." />
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-display text-lg font-semibold">Companies with drives at this college</h2>
            <PartnershipsTable collegeId={collegeId} />
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-display text-lg font-semibold">Company drives</h2>
            <DrivesTable collegeId={collegeId} />
          </Card>
        </>
      )}
    </>
  );
}

export function CompanyDetailPage({ companyId }: { companyId: string }) {
  const { range, label } = useAdminRange();
  const q = useQuery({
    queryKey: ["admin", "company", companyId, range],
    queryFn: () => adminService.companies.detail(companyId, range),
    ...adminQueryOptions,
  });
  const c: CompanyRow | undefined = q.data?.company;

  return (
    <>
      <BackLink to="/admin/companies" label="All companies" />
      {q.isError ? (
        <NotFound what="Company" error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <PageHeader
            title={c?.name ?? "Company"}
            description={
              c && (
                <span className="flex flex-wrap items-center gap-2">
                  {[c.industry, c.size].filter(Boolean).join(" · ")}
                  <ActivityBadge active={c.is_active} />
                  {c.is_verified && (
                    <span className="inline-flex items-center gap-1 text-xs text-primary">
                      <BadgeCheck className="h-3.5 w-3.5" /> Verified
                    </span>
                  )}
                </span>
              )
            }
          />
          <KpiGroup title="Company">
            <KpiCard label="Jobs posted" loading={q.isLoading} value={fmtInt(c?.jobs)} />
            <KpiCard label="Drives" loading={q.isLoading} value={fmtInt(c?.drives)} />
            <KpiCard label="Colleges engaged" loading={q.isLoading} value={fmtInt(c?.colleges)} />
            <KpiCard label="Registered" loading={q.isLoading} value={c ? fmtDate(c.registered_at) : "—"} sub={c && `Last activity ${fmtRelative(c.last_activity)}`} />
          </KpiGroup>
          <KpiGroup title={`Hiring — ${label}`}>
            <FunnelKpis r={c} loading={q.isLoading} />
          </KpiGroup>
          {c?.owner_email && <p className="text-xs text-muted-foreground">Recruiter account: {c.owner_email}</p>}

          <Card className="p-5">
            <h2 className="mb-3 font-display text-lg font-semibold">Colleges this company works with</h2>
            <PartnershipsTable companyId={companyId} />
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-display text-lg font-semibold">Company drives</h2>
            <DrivesTable companyId={companyId} />
          </Card>
        </>
      )}
    </>
  );
}
