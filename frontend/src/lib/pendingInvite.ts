/** An interview invitation link must survive the login redirect, so the id is parked here. */
const PARAM = "ai_interview_invite";
const KEY = "mirracle.pendingAiInterviewInvite";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const UUIDISH = /^[A-Za-z0-9-]{8,64}$/;

export const INVITE_PARAM = PARAM;

/** Remember the invite in the current URL, if any. Safe to call anywhere, anytime. */
export function capturePendingInvite(search: string, now = Date.now()): string | null {
  try {
    const id = new URLSearchParams(search).get(PARAM);
    if (!id || !UUIDISH.test(id)) return null;
    window.localStorage.setItem(KEY, JSON.stringify({ id, at: now }));
    return id;
  } catch {
    return null;
  }
}

/** The remembered invite id, or null when none or too old. */
export function readPendingInvite(now = Date.now()): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const { id, at } = JSON.parse(raw) as { id?: unknown; at?: unknown };
    if (typeof id !== "string" || typeof at !== "number" || now - at > MAX_AGE_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return id;
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}
