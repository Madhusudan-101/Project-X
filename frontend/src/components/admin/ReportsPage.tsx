import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { adminQueryOptions } from "@/hooks/admin/query";
import { useAdminRange } from "@/hooks/admin/use-admin-range";
import { adminService } from "@/services/api/admin/admin";
import { ExportButton, PageHeader } from "./controls";
import { fmtDate, fmtInt } from "./format";
import { KpiCard } from "./KpiCard";
import { ChartSkeleton, ErrorBlock } from "./StateViews";

interface ReportDef {
  title: string;
  description: string;
  onExport: () => Promise<{ blob: Blob; truncated: boolean; rows: number; total: number }>;
  filename: string;
}

/** A hub, not a second export system: every per-table report reuses that
 * table's own /export endpoint (Colleges, Companies, Candidates, Drives,
 * Partnerships, Users, Audit Log) — this page does not duplicate their
 * logic. Only the two aggregate views with no existing export (funnel-by-
 * college, compensation) get their own backend route; see
 * backend/app/routers/admin/reports.py. */
export function ReportsPage() {
  const { range, label } = useAdminRange();
  const usage = useQuery({ queryKey: ["admin", "reports", "usage", range], queryFn: () => adminService.reports.platformUsage(range), ...adminQueryOptions });

  const reports: ReportDef[] = [
    {
      title: "Application funnel report",
      description: "Every college in the directory (registered or not) with its applications → shortlisted → selected funnel.",
      onExport: () => adminService.reports.download(adminService.reports.applicationFunnelExportUrl(range)),
      filename: "application_funnel_report.csv",
    },
    {
      title: "Compensation report",
      description: "Advertised vs. actual-offer CTC per company — posted roles and filled (selected-candidate) roles.",
      onExport: () => adminService.reports.download(adminService.reports.compensationExportUrl(range)),
      filename: "compensation_report.csv",
    },
    { title: "College performance report", description: "The Colleges table's own export, every column.", onExport: () => adminService.colleges.export(range, { registration: "all" }), filename: "college_performance_report.csv" },
    { title: "Company activity report", description: "The Companies table's own export, every column.", onExport: () => adminService.companies.export(range, {}), filename: "company_activity_report.csv" },
    { title: "Candidate report", description: "The Candidates table's own export, every column.", onExport: () => adminService.candidates.export(range, {}), filename: "candidate_report.csv" },
    { title: "Drive report", description: "The Drives table's own export, every column.", onExport: () => adminService.drives.export(range, {}), filename: "drive_report.csv" },
    { title: "Platform usage — raw event log", description: "The Audit Log's own export: every tracked sign-in, block, export and report in the period.", onExport: () => adminService.auditLog.export(range, {}), filename: "platform_usage_events.csv" },
  ];

  return (
    <>
      <PageHeader
        title="Reports"
        description={
          <>
            Filtered by <span className="font-medium text-foreground">{label}</span> where the report has a date-scoped figure. No
            report values are invented — a report with nothing to show downloads a header row only.
          </>
        }
      />

      <Card className="p-5">
        <h2 className="font-display text-lg font-semibold">Platform usage, this period</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Only actions this backend tracks (sign-ins, provisioning, blocks, exports, reports) or already timestamps (applications, drives,
          resume analyses).
          {usage.data?.events_tracking_since && (
            <> Sign-in/export/report tracking began {fmtDate(usage.data.events_tracking_since)} — a period before that shows 0 for those, not because nothing happened.</>
          )}
        </p>
        {usage.isLoading ? (
          <ChartSkeleton className="h-24" />
        ) : usage.isError ? (
          <ErrorBlock error={usage.error} onRetry={() => usage.refetch()} />
        ) : usage.data ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Sign-ins" value={fmtInt(usage.data.logins)} />
            <KpiCard label="Blocked-account attempts" value={fmtInt(usage.data.blocked_login_attempts)} />
            <KpiCard label="Accounts provisioned" value={fmtInt(usage.data.accounts_provisioned)} />
            <KpiCard label="Users blocked / unblocked" value={`${fmtInt(usage.data.users_blocked)} / ${fmtInt(usage.data.users_unblocked)}`} />
            <KpiCard label="CSV exports" value={fmtInt(usage.data.csv_exports)} />
            <KpiCard label="Reports generated" value={fmtInt(usage.data.reports_generated)} />
            <KpiCard label="Applications submitted" value={fmtInt(usage.data.applications_submitted)} />
            <KpiCard label="Drives created" value={fmtInt(usage.data.drives_created)} />
            <KpiCard label="Resume analyses" value={fmtInt(usage.data.resume_analyses)} />
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {reports.map((r) => (
          <Card key={r.title} className="flex flex-col gap-3 p-5">
            <div>
              <h3 className="font-medium">{r.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{r.description}</p>
            </div>
            <div className="mt-auto">
              <ExportButton onExport={r.onExport} filename={r.filename} />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
