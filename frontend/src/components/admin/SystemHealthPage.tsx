import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { adminService } from "@/services/api/admin/admin";
import type { HealthStatus } from "@/types/admin/admin";
import { PageHeader, StatusBadge } from "./controls";
import type { Tone } from "./status";
import { fmtDate } from "./format";
import { ChartSkeleton, ErrorBlock } from "./StateViews";

const STATUS_META: Record<HealthStatus, { tone: Tone; label: string }> = {
  operational: { tone: "success", label: "Operational" },
  degraded: { tone: "warning", label: "Degraded" },
  unavailable: { tone: "destructive", label: "Unavailable" },
  unknown: { tone: "muted", label: "Unknown" },
};

const CHECK_LABEL: Record<string, string> = {
  api: "API",
  database: "Database",
  authentication: "Authentication",
  storage: "Storage",
  realtime: "Realtime",
  background_jobs: "Background jobs",
};

/** Only checks this backend can actually verify are reported operational/
 * degraded/unavailable; everything else is "Unknown" — never faked. See the
 * backend route's docstring for exactly what each check does. */
export function SystemHealthPage() {
  const q = useQuery({ queryKey: ["admin", "system-health"], queryFn: adminService.systemHealth, refetchInterval: 60_000 });

  return (
    <>
      <PageHeader
        title="System Health"
        description="Only checks this backend can actually verify. Realtime and background jobs are 'Unknown' because this application doesn't use them — not because a check failed."
      />
      {q.isLoading ? (
        <ChartSkeleton className="h-64" />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => q.refetch()} />
      ) : q.data ? (
        <>
          <Card className="flex items-center justify-between p-4">
            <span className="text-sm font-medium">Overall</span>
            <span className="flex items-center gap-2">
              <StatusBadge tone={STATUS_META[q.data.overall].tone}>{STATUS_META[q.data.overall].label}</StatusBadge>
              <span className="text-xs text-muted-foreground">Checked {fmtDate(q.data.checked_at)}</span>
            </span>
          </Card>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(q.data.checks) as (keyof typeof q.data.checks)[]).map((key) => {
              const c = q.data!.checks[key];
              const meta = STATUS_META[c.status];
              return (
                <Card key={key} className="p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{CHECK_LABEL[key] ?? key}</span>
                    <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                  </div>
                  {typeof c.latency_ms === "number" && <p className="mt-1 text-xs text-muted-foreground">{c.latency_ms} ms</p>}
                  {c.detail && <p className="mt-1 text-xs text-muted-foreground">{c.detail}</p>}
                </Card>
              );
            })}
          </div>
        </>
      ) : null}
    </>
  );
}
