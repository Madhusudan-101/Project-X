import { format, formatDistanceToNow, parseISO } from "date-fns";

export const NA = "N/A";

const int = new Intl.NumberFormat("en-IN");
const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 2,
});

export const fmtInt = (n: number | null | undefined): string => (n == null ? NA : int.format(n));

/** Ratio (0–1) → "42.5%". null (no denominator) stays N/A — never a fake 0%. */
export const fmtPct = (ratio: number | null | undefined): string =>
  ratio == null ? NA : `${(ratio * 100).toFixed(1)}%`;

export const fmtDecimal = (n: number | null | undefined, digits = 1): string =>
  n == null ? NA : n.toFixed(digits);

export const fmtInr = (n: number | null | undefined): string => (n == null ? NA : inr.format(n));

export const fmtDate = (iso: string | null | undefined): string =>
  iso ? format(parseISO(iso), "d MMM yyyy") : "—";

export const fmtRelative = (iso: string | null | undefined): string =>
  iso ? formatDistanceToNow(parseISO(iso), { addSuffix: true }) : "No activity yet";

/** numerator / denominator, or null when the denominator is 0. */
export const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

/** Distinct candidates selected ÷ distinct candidates who applied (null = N/A). */
export const placementRate = (r: { selected_applicants: number; applicants: number }): number | null =>
  ratio(r.selected_applicants, r.applicants);
