/** Wording for the "finding a partner" screen: honest about how long it is taking, with a way out. */

export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/** After this long with nobody free, offer to schedule instead of waiting forever. */
export const SUGGEST_SCHEDULE_AFTER_SECONDS = 90;

export function waitingNote(seconds: number): { text: string; suggestSchedule: boolean } {
  if (seconds < 20) return { text: "Looking for a partner…", suggestSchedule: false };
  if (seconds < SUGGEST_SCHEDULE_AFTER_SECONDS) {
    return {
      text: "Still looking. People are paired as soon as they arrive.",
      suggestSchedule: false,
    };
  }
  return {
    text: "Nobody else is free right now. You can keep waiting, or pick a time and invite someone.",
    suggestSchedule: true,
  };
}
