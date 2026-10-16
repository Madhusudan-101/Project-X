/**
 * Meetings scheduled from the dashboard have an end time. PeerMeet shows how long is left and warns
 * before it, but never cuts the call off: the people in it decide when to stop.
 */

/** Parse the `until` value from the link (milliseconds since epoch). Anything odd means "no end time". */
export function parseUntil(raw, now = Date.now()) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Reject nonsense: before 2020 or more than 12 hours ahead.
  if (n < 1577836800000 || n - now > 12 * 60 * 60 * 1000) return null;
  return n;
}

/** @returns {{ minutesLeft: number, over: boolean, label: string } | null} */
export function endCountdown(until, now = Date.now()) {
  if (!until) return null;
  const ms = until - now;
  if (ms <= 0) return { minutesLeft: 0, over: true, label: 'Scheduled time is up' };
  const minutesLeft = Math.ceil(ms / 60000);
  return { minutesLeft, over: false, label: minutesLeft === 1 ? '1 min left' : `${minutesLeft} min left` };
}

/** Which warning (if any) to show now, given the last one shown. Each fires once. */
export function nextWarning(until, now, lastShown) {
  const c = endCountdown(until, now);
  if (!c) return null;
  if (c.over && lastShown !== 'over') return { key: 'over', text: 'The scheduled time is over. You can keep talking, or wrap up.' };
  if (!c.over && c.minutesLeft <= 1 && lastShown !== 'one' && lastShown !== 'over') return { key: 'one', text: '1 minute left in the scheduled time.' };
  if (!c.over && c.minutesLeft <= 5 && !lastShown) return { key: 'five', text: '5 minutes left in the scheduled time.' };
  return null;
}
