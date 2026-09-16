import { useEffect, useState } from "react";
import {
  Activity,
  Award,
  Briefcase,
  Building2,
  CalendarCheck,
  GraduationCap,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Users,
} from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dashboardService, departmentsService } from "@/services/api/college/college";
import type { DashboardStats, Department, ScoreDistribution } from "@/types/college/college";

function truncateDeptName(name: string, max = 14): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/** Custom XAxis tick for the department bar charts: angled and truncated so
 * long department names never overlap or get silently dropped by recharts'
 * default tick-skipping — the full name is still shown on hover via the
 * chart's own tooltip. */
function DeptAxisTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  if (x === undefined || y === undefined || !payload) return null;
  return (
    <text
      x={x}
      y={y}
      dy={10}
      textAnchor="end"
      transform={`rotate(-30 ${x} ${y})`}
      fill="var(--color-muted-foreground)"
      fontSize={11}
    >
      {truncateDeptName(payload.value)}
    </text>
  );
}

export function DashboardTab() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [distribution, setDistribution] = useState<ScoreDistribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [departments, setDepartments] = useState<Department[] | null>(null);
  const [deptLoading, setDeptLoading] = useState(true);
  const [deptError, setDeptError] = useState<string | null>(null);

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

  // Fetched independently from the stats/distribution above so a departments
  // failure never blocks the rest of the dashboard from rendering.
  useEffect(() => {
    let cancelled = false;
    setDeptLoading(true);
    setDeptError(null);
    departmentsService
      .list()
      .then((rows) => {
        if (!cancelled) setDepartments(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setDeptError(err instanceof Error ? err.message : "Failed to load departments");
      })
      .finally(() => {
        if (!cancelled) setDeptLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chartData = distribution
    ? Object.entries(distribution).map(([bucket, count]) => ({ bucket, count }))
    : [];

  const deptChartData = (departments ?? []).map((d) => ({
    name: d.name,
    placementRate: d.placementRate,
    avgScore: d.avgEmployabilityScore,
  }));

  const placementSegments = stats
    ? [
        { label: "Placed", count: stats.placedStudents, color: "var(--color-success)" },
        { label: "Not placed", count: stats.notPlacedStudents, color: "var(--color-border)" },
        {
          label: "Offer declined",
          count: stats.offerDeclinedStudents,
          color: "var(--color-destructive)",
        },
      ]
    : [];

  const driveSegments = stats
    ? [
        { label: "Active", count: stats.activeCompanyDrives, color: "var(--color-success)" },
        { label: "Draft", count: stats.draftDrives, color: "var(--color-secondary)" },
        { label: "Closed", count: stats.closedDrives, color: "var(--color-border)" },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold md:text-3xl">Placement Analytics</h1>
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
          Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
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
              icon={CalendarCheck}
              label="Total drives"
              value={stats ? String(stats.totalDrives) : "—"}
            />
            <StatCard
              icon={ShieldCheck}
              label="Verified students"
              value={stats ? String(stats.verifiedStudents) : "—"}
            />
            <StatCard
              icon={UserCheck}
              label="Students placed"
              value={stats ? String(stats.placedStudents) : "—"}
            />
            <StatCard
              icon={GraduationCap}
              label="Placement rate"
              value={stats ? `${stats.placementPercentage.toFixed(1)}%` : "—"}
            />
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Placement distribution</h2>
            <UserCheck className="h-5 w-5 text-primary" />
          </div>
          {loading ? (
            <Skeleton className="h-56 w-full rounded-lg" />
          ) : !stats || stats.totalStudents === 0 ? (
            <div className="grid h-56 place-items-center rounded-lg border border-dashed border-border/70 bg-surface/60 text-center text-sm text-muted-foreground">
              No students in the roster yet.
            </div>
          ) : (
            <StatusDonutChart total={stats.totalStudents} segments={placementSegments} />
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Drive status</h2>
            <Briefcase className="h-5 w-5 text-primary" />
          </div>
          {loading ? (
            <Skeleton className="h-56 w-full rounded-lg" />
          ) : !stats || stats.totalDrives === 0 ? (
            <div className="grid h-56 place-items-center rounded-lg border border-dashed border-border/70 bg-surface/60 text-center text-sm text-muted-foreground">
              No drives scheduled yet.
            </div>
          ) : (
            <StatusDonutChart total={stats.totalDrives} segments={driveSegments} />
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Placement trends</h2>
            <TrendingUp className="h-5 w-5 text-primary" />
          </div>
          <div className="grid h-56 place-items-center rounded-lg border border-dashed border-border/70 bg-surface/60 p-4 text-center text-sm text-muted-foreground">
            Historical trend data isn't available yet — tracking placement dates over time isn't
            part of the current roster schema.
          </div>
        </Card>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-semibold">Placement rate by department</h2>
              <p className="text-xs text-muted-foreground">Students matched to a department by branch.</p>
            </div>
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          {deptLoading ? (
            <Skeleton className="h-64 w-full rounded-lg" />
          ) : deptError ? (
            <div className="text-sm text-destructive">{deptError}</div>
          ) : deptChartData.length === 0 ? (
            <div className="grid h-64 place-items-center rounded-lg border border-dashed border-border/70 bg-surface/60 text-center text-sm text-muted-foreground">
              No departments configured yet — add one in the Departments tab.
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deptChartData} margin={{ top: 8, right: 8, left: -16, bottom: 24 }}>
                  <XAxis
                    dataKey="name"
                    interval={0}
                    height={56}
                    tick={<DeptAxisTick />}
                    axisLine={{ stroke: "var(--color-border)" }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    unit="%"
                    domain={[0, 100]}
                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ChartTooltip
                    cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
                    formatter={(value: number) => [`${value.toFixed(1)}%`, "Placement rate"]}
                    contentStyle={{
                      background: "var(--color-popover)",
                      color: "var(--color-popover-foreground)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="placementRate" fill="var(--color-secondary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-semibold">Avg. employability by department</h2>
              <p className="text-xs text-muted-foreground">Average of each department's students.</p>
            </div>
            <Award className="h-5 w-5 text-primary" />
          </div>
          {deptLoading ? (
            <Skeleton className="h-64 w-full rounded-lg" />
          ) : deptError ? (
            <div className="text-sm text-destructive">{deptError}</div>
          ) : deptChartData.length === 0 ? (
            <div className="grid h-64 place-items-center rounded-lg border border-dashed border-border/70 bg-surface/60 text-center text-sm text-muted-foreground">
              No departments configured yet — add one in the Departments tab.
            </div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={deptChartData} margin={{ top: 8, right: 8, left: -16, bottom: 24 }}>
                  <XAxis
                    dataKey="name"
                    interval={0}
                    height={56}
                    tick={<DeptAxisTick />}
                    axisLine={{ stroke: "var(--color-border)" }}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    domain={[0, 100]}
                    tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <ChartTooltip
                    cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
                    formatter={(value: number) => [value.toFixed(1), "Avg. employability score"]}
                    contentStyle={{
                      background: "var(--color-popover)",
                      color: "var(--color-popover-foreground)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="avgScore" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="mb-4 font-display text-lg font-semibold">Department overview</h2>
        {deptLoading ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : deptError ? (
          <div className="text-sm text-destructive">{deptError}</div>
        ) : !departments || departments.length === 0 ? (
          <div className="grid h-40 place-items-center rounded-lg border border-dashed border-border/70 bg-surface/60 text-center text-sm text-muted-foreground">
            No departments configured yet — add one in the Departments tab.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Students</TableHead>
                  <TableHead>Avg. employability</TableHead>
                  <TableHead>Placement rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{d.studentCount}</TableCell>
                    <TableCell>{d.avgEmployabilityScore.toFixed(1)}</TableCell>
                    <TableCell>{d.placementRate.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
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

/** Donut chart + custom legend for a small part-of-whole breakdown (2-4
 * categories). Center label shows the total; legend shows count and % for
 * every category (including zero-count ones the pie itself omits, since a
 * 0-value slice renders as nothing in recharts). */
function StatusDonutChart({
  total,
  segments,
}: {
  total: number;
  segments: { label: string; count: number; color: string }[];
}) {
  const data = segments.filter((s) => s.count > 0).map((s) => ({ name: s.label, value: s.count }));
  const colorByName = new Map(segments.map((s) => [s.label, s.color]));

  return (
    <div>
      <div className="relative h-40">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={50}
              outerRadius={72}
              paddingAngle={2}
              stroke="var(--color-card)"
              strokeWidth={2}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={colorByName.get(entry.name)} />
              ))}
            </Pie>
            <ChartTooltip
              formatter={(value: number, name: string) => [
                `${value} (${total > 0 ? ((value / total) * 100).toFixed(1) : 0}%)`,
                name,
              ]}
              contentStyle={{
                background: "var(--color-popover)",
                color: "var(--color-popover-foreground)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-xl font-semibold">{total}</span>
          <span className="text-[10px] text-muted-foreground">Total</span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}: <span className="font-medium text-foreground">{s.count}</span>
            <span>({total > 0 ? ((s.count / total) * 100).toFixed(0) : 0}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}
