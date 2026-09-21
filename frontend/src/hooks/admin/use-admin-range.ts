import { useMemo } from "react";
import {
  addDays,
  addMonths,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfYear,
  subDays,
} from "date-fns";
import { useAdminRangeStore, type RangePreset } from "@/store/admin/dateRange";
import type { AdminRange } from "@/types/admin/admin";

export const PRESET_LABELS: Record<Exclude<RangePreset, "custom">, string> = {
  today: "Today",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  this_month: "This month",
  last_month: "Last month",
  this_year: "This year",
  all_time: "All time",
};

/** Resolve a preset to half-open [from, to) instants using the admin's LOCAL
 * calendar, so "Today" means their today — the backend only ever sees instants. */
export function resolveRange(
  preset: RangePreset,
  customFrom: string,
  customTo: string,
  now: Date = new Date(),
): AdminRange {
  const today = startOfDay(now);
  const iso = (d: Date) => d.toISOString();
  switch (preset) {
    case "today":
      return { from: iso(today), to: iso(addDays(today, 1)) };
    case "last_7_days":
      return { from: iso(subDays(today, 6)), to: iso(addDays(today, 1)) };
    case "last_30_days":
      return { from: iso(subDays(today, 29)), to: iso(addDays(today, 1)) };
    case "this_month": {
      const start = startOfMonth(today);
      return { from: iso(start), to: iso(addMonths(start, 1)) };
    }
    case "last_month": {
      const start = startOfMonth(today);
      return { from: iso(addMonths(start, -1)), to: iso(start) };
    }
    case "this_year": {
      const start = startOfYear(today);
      return { from: iso(start), to: iso(new Date(start.getFullYear() + 1, 0, 1)) };
    }
    case "custom": {
      if (!customFrom || !customTo) return {};
      // The end day is inclusive in the UI, exclusive on the wire.
      return { from: iso(startOfDay(parseISO(customFrom))), to: iso(addDays(startOfDay(parseISO(customTo)), 1)) };
    }
    case "all_time":
      return {};
  }
}

export function rangeLabel(preset: RangePreset, customFrom: string, customTo: string): string {
  if (preset !== "custom") return PRESET_LABELS[preset];
  if (!customFrom || !customTo) return "Custom range";
  const f = parseISO(customFrom);
  const t = parseISO(customTo);
  return customFrom === customTo ? format(f, "MMM d, yyyy") : `${format(f, "MMM d")} – ${format(t, "MMM d, yyyy")}`;
}

/** The active admin date range, ready to pass to the service layer and to use
 * in a React Query key (a new object only when the range really changes). */
export function useAdminRange() {
  const preset = useAdminRangeStore((s) => s.preset);
  const customFrom = useAdminRangeStore((s) => s.customFrom);
  const customTo = useAdminRangeStore((s) => s.customTo);
  // Recompute when the calendar day rolls over so a tab left open overnight
  // doesn't keep showing yesterday as "Today".
  const day = new Date().toDateString();
  return useMemo(
    () => ({
      range: resolveRange(preset, customFrom, customTo),
      label: rangeLabel(preset, customFrom, customTo),
      isAllTime: preset === "all_time",
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preset, customFrom, customTo, day],
  );
}
