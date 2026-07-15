import { useEffect, useState } from "react";
import { Activity, Award, Briefcase, GraduationCap, ShieldCheck, Users } from "lucide-react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { dashboardService } from "@/services/api/college";
import type { DashboardStats, ScoreDistribution } from "@/types/college";

export function DashboardTab() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [distribution, setDistribution] = useState<ScoreDistribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([dashboardService.stats(), dashboardService.scoreDistribution()])
      .then(([s, d]) => {
        if (cancelled) return;
        setStats(s);
        setDistribution(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chartData = distribution
    ? Object.entries(distribution).map(([bucket, count]) => ({ bucket, count }))
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold md:text-3xl">Placement dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Live numbers pulled from your college's roster and active drives.
        </p>
      </div>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : (
          <>
            <StatCard
              icon={Users}
              label="Total students"
              value={stats ? String(stats.totalStudents) : "—"}
            />
            <StatCard
              icon={Award}
              label="Avg. employability score"
              value={stats ? stats.averageEmployabilityScore.toFixed(1) : "—"}
            />
            <StatCard
              icon={Briefcase}
              label="Active company drives"
              value={stats ? String(stats.activeCompanyDrives) : "—"}
            />
            <StatCard
              icon={ShieldCheck}
              label="Verified students"
              value={stats ? String(stats.verifiedStudents) : "—"}
            />
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-semibold">
                Employability score distribution
              </h2>
              <p className="text-xs text-muted-foreground">
                Students bucketed by employability score.
              </p>
            </div>
            <GraduationCap className="h-5 w-5 text-primary" />
          </div>
          {loading ? (
            <Skeleton className="h-64 w-full rounded-lg" />
          ) : chartData.every((d) => d.count === 0) ? (
            <div className="grid h-64 place-items-center rounded-lg border border-dashed border-border/70 bg-surface/60 text-center text-sm text-muted-foreground">
              No students in the roster yet — upload a CSV to populate this chart.
            </div>
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
                  <Bar dataKey="count" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Recent activity</h2>
            <Activity className="h-5 w-5 text-primary" />
          </div>
          <div className="grid h-56 place-items-center rounded-lg border border-dashed border-border/70 bg-surface/60 p-6 text-center text-sm text-muted-foreground">
            No activity feed available yet. This will populate once an activity-log endpoint ships
            on the backend.
          </div>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
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
