import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Award, Briefcase, Download, FileBarChart, ShieldCheck, Users } from "lucide-react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { dashboardService, downloadCsvBlob, shortlistService } from "@/services/api/college";
import type { DashboardStats, ScoreDistribution } from "@/types/college";

export function ReportsTab() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [distribution, setDistribution] = useState<ScoreDistribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([dashboardService.stats(), dashboardService.scoreDistribution()])
      .then(([s, d]) => {
        if (cancelled) return;
        setStats(s);
        setDistribution(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load report data");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const chartData = distribution
    ? Object.entries(distribution).map(([bucket, count]) => ({ bucket, count }))
    : [];

  const handleExportFullRoster = async () => {
    setExporting(true);
    try {
      // Reuses GET /api/shortlist/export with no filters applied — the closest
      // thing to a "full roster report" export the backend currently exposes.
      const blob = await shortlistService.exportCsv({});
      downloadCsvBlob(blob, "placement_report.csv");
      toast.success("Report CSV downloaded");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold md:text-3xl">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A snapshot of placement readiness, built from your dashboard and shortlist data.
          </p>
        </div>
        <Button
          onClick={handleExportFullRoster}
          disabled={exporting}
          className="bg-gradient-brand text-primary-foreground"
        >
          <Download className="mr-2 h-4 w-4" />{" "}
          {exporting ? "Exporting…" : "Download full roster CSV"}
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : (
          <>
            <ReportStat
              icon={Users}
              label="Total students"
              value={stats ? String(stats.totalStudents) : "—"}
            />
            <ReportStat
              icon={Award}
              label="Avg. employability"
              value={stats ? stats.averageEmployabilityScore.toFixed(1) : "—"}
            />
            <ReportStat
              icon={Briefcase}
              label="Active drives"
              value={stats ? String(stats.activeCompanyDrives) : "—"}
            />
            <ReportStat
              icon={ShieldCheck}
              label="Verified students"
              value={stats ? String(stats.verifiedStudents) : "—"}
            />
          </>
        )}
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold">Score distribution report</h2>
            <p className="text-xs text-muted-foreground">
              For NAAC/NIRF-style readiness reporting. Sourced from
              /api/dashboard/score-distribution.
            </p>
          </div>
          <FileBarChart className="h-5 w-5 text-primary" />
        </div>
        {loading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <XAxis
                  dataKey="bucket"
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                  axisLine={{ stroke: "var(--color-border)" }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <ChartTooltip
                  cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
                  contentStyle={{
                    background: "var(--color-popover)",
                    color: "var(--color-popover-foreground)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" fill="var(--color-secondary)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card className="border-dashed p-5 text-sm text-muted-foreground">
        Need a filtered report (specific branch, graduation year, or verification status)? Use the{" "}
        <span className="font-medium text-foreground">Shortlist</span> tab — the same filter and
        export endpoint powers targeted CSV reports.
      </Card>
    </div>
  );
}

function ReportStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <Card className="p-4">
      <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="mt-3 font-display text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}
