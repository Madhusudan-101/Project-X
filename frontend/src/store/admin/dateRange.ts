import { create } from "zustand";

export type RangePreset =
  | "today"
  | "last_7_days"
  | "last_30_days"
  | "this_month"
  | "last_month"
  | "this_year"
  | "all_time"
  | "custom";

interface AdminRangeState {
  preset: RangePreset;
  /** yyyy-mm-dd (local calendar days), only meaningful when preset === "custom". */
  customFrom: string;
  customTo: string;
  setPreset: (preset: Exclude<RangePreset, "custom">) => void;
  setCustom: (from: string, to: string) => void;
}

/** The one date filter shared by every admin page. Not persisted: presets are
 * relative to "now", so a stored "today" would silently go stale. */
export const useAdminRangeStore = create<AdminRangeState>((set) => ({
  preset: "last_30_days",
  customFrom: "",
  customTo: "",
  setPreset: (preset) => set({ preset }),
  setCustom: (customFrom, customTo) => set({ preset: "custom", customFrom, customTo }),
}));
