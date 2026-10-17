import type { OADisplayCheck } from "@/types/candidate/assessment";

/**
 * Can a web page tell how many monitors are connected? Partly.
 *
 *  1. `screen.isExtended` (Chrome / Edge 100+, no permission prompt): true when the desktop spans more
 *     than one display. That is exactly the "second monitor" case, so it is what we trust first.
 *  2. `window.getScreenDetails()` (the Window Management API, same browsers): an exact count, but the
 *     browser asks "Manage windows on all your displays". Only used when `isExtended` is missing.
 *  3. Firefox and Safari expose neither, so the honest answer there is "unknown". The check never
 *     guesses; the result is recorded as unverified and the recruiter decides what that means.
 *
 * What it cannot see: a screen that merely MIRRORS the main one (nothing extra is on it), a second
 * computer, or a phone. It is a deterrent plus evidence, not a guarantee.
 */
export interface DisplayEnv {
  screen?: { isExtended?: boolean };
  getScreenDetails?: () => Promise<{ screens: unknown[] }>;
}

const realEnv = (): DisplayEnv =>
  typeof window === "undefined" ? {} : (window as unknown as DisplayEnv);

/** true / false when the browser knows, null when it cannot tell. */
export function readIsExtended(env: DisplayEnv = realEnv()): boolean | null {
  const v = env.screen?.isExtended;
  return typeof v === "boolean" ? v : null;
}

export async function checkDisplays(env: DisplayEnv = realEnv()): Promise<OADisplayCheck> {
  const extended = readIsExtended(env);
  if (extended !== null) {
    return {
      status: extended ? "multiple" : "single",
      count: extended ? null : 1,
      method: "is-extended",
    };
  }
  if (typeof env.getScreenDetails === "function") {
    try {
      const { screens } = await env.getScreenDetails();
      return {
        status: screens.length > 1 ? "multiple" : "single",
        count: screens.length,
        method: "window-management",
      };
    } catch {
      /* permission refused: fall through to "unknown" */
    }
  }
  return { status: "unknown", count: null, method: "unsupported" };
}
