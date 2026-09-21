import { format, parseISO } from "date-fns";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";
import type { TrendPoint } from "@/types/admin/admin";
import { fmtInt } from "./format";

/**
 * Categorical series colours, in fixed order (never cycled), checked with the
 * data-viz palette validator against the app's dark card surface: all inside
 * the dark lightness band, adjacent CVD ΔE >= 15, contrast >= 3:1.
 */
export const SERIES = {
  indigo: "#5283fe",
  cyan: "#00a5b5",
  amber: "#be7f00",
} as const;

const AXIS_TICK = { fill: "var(--color-muted-foreground)", fontSize: 11 };
const TOOLTIP_STYLE = {
  background: "var(--color-popover)",
  color: "var(--color-popover-foreground)",
  border: "1px solid var(--color-border)",
  borderRadius: 8,
  fontSize: 12,
};

export interface Series {
  key: keyof TrendPoint;
  label: string;
  color: string;
}

function bucketLabel(iso: string, bucket: "day" | "week" | "month"): string {
  return format(parseISO(iso), bucket === "month" ? "MMM yy" : "d MMM");
}

/** Time series line chart. With 2+ series a legend is always shown (identity is
 * never colour-alone); a single series is named by the card title. The hover
 * tooltip lists every series at the hovered bucket. */
export function TrendChart({
  points,
  bucket,
  series,
  height = 240,
}: {
  points: TrendPoint[];
  bucket: "day" | "week" | "month";
  series: Series[];
  height?: number;
}) {
  const data = points.map((p) => ({ ...p, label: bucketLabel(p.bucket, bucket) }));
  return (
    <div>
      {series.length > 1 && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded" style={{ backgroundColor: s.color }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div style={{ height }} role="img" aria-label={`${series.map((s) => s.label).join(", ")} over time`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeOpacity={0.5} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: "var(--color-border)" }} tickLine={false} minTickGap={24} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ stroke: "var(--color-muted-foreground)", strokeOpacity: 0.4 }}
              formatter={(value: number, name: string) => [fmtInt(value), name]}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--color-card)", strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Vertical bars for a small ordered distribution (e.g. salary buckets). */
export function ColumnChart({
  data,
  color = SERIES.indigo,
  height = 200,
  label,
}: {
  data: { bucket: string; count: number }[];
  color?: string;
  height?: number;
  label: string;
}) {
  return (
    <div style={{ height }} role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-border)" strokeOpacity={0.5} vertical={false} />
          <XAxis dataKey="bucket" tick={AXIS_TICK} axisLine={{ stroke: "var(--color-border)" }} tickLine={false} interval={0} />
          <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
            formatter={(value: number) => [fmtInt(value), "Roles"]}
          />
          <Bar dataKey="count" fill={color} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface BarListItem {
  key: string;
  label: string;
  value: number;
  /** Text shown at the right of the row; defaults to the number. */
  display?: string;
  /** Small secondary text under the label. */
  sub?: string;
}

/** Ranked horizontal bars: label left, value right, one colour. Every bar is
 * labelled with its value (a ranking is read by comparing lengths *and* numbers). */
export function BarList({
  items,
  color = SERIES.indigo,
  max,
}: {
  items: BarListItem[];
  color?: string;
  /** Scale ceiling; defaults to the largest value (use 1 for ratios). */
  max?: number;
}) {
  const ceiling = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate font-medium" title={i.label}>
              {i.label}
              {i.sub && <span className="ml-1.5 font-normal text-muted-foreground">· {i.sub}</span>}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">{i.display ?? fmtInt(i.value)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className="h-full rounded-full"
              style={{ width: `${i.value > 0 ? Math.max(2, Math.min(100, (i.value / ceiling) * 100)) : 0}%`, backgroundColor: color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
