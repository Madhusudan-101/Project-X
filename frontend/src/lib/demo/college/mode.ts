/**
 * College Portal Demo Mode — where "demo" is decided.
 *
 * Demo Mode is a property of the URL, never of a stored flag or a client-supplied
 * role: only pages under /demo/college are demo pages. That makes it impossible
 * for a persisted value (or a forged one) to turn the real /college portal into
 * the demo, or the demo into a path that talks to the live API.
 *
 * Kept free of framework / browser imports so it can be unit-tested with plain
 * `node --test` (see mode.test.ts).
 */

export const DEMO_BASE = "/demo/college";
export const LIVE_BASE = "/college";

/** The fictional institution every demo record belongs to. */
export const DEMO_COLLEGE_ID = "demo-college-northstar";
export const DEMO_COLLEGE_NAME = "Northstar Institute of Technology";

/** True only for /demo/college and its sub-paths (not /demo/college-x, not /college/demo/...). */
export function isDemoPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === DEMO_BASE || pathname.startsWith(`${DEMO_BASE}/`);
}

/** Route prefix the College Portal pages should link under for the given location. */
export function collegeBasePath(pathname: string | null | undefined): string {
  return isDemoPath(pathname) ? DEMO_BASE : LIVE_BASE;
}

/** Evaluated at call time, in the browser. On the server there is no location, so never demo. */
export function isDemoLocation(): boolean {
  return typeof window !== "undefined" && isDemoPath(window.location?.pathname);
}

export class LiveApiBlockedError extends Error {
  readonly code = "demo_live_api_blocked";
  constructor() {
    super("Demo Mode never calls the live API.");
    this.name = "LiveApiBlockedError";
  }
}

/**
 * Defence in depth for the HTTP client: if any code path on a demo page tried to
 * reach the real API (and attach the visitor's real session token, if they happen
 * to be signed in elsewhere), refuse before a request is built.
 */
export function assertLiveApiAllowed(pathname: string | null | undefined): void {
  if (isDemoPath(pathname)) throw new LiveApiBlockedError();
}

/** Document title for a demo page, e.g. "Students — College Portal demo · Northstar Institute of Technology". */
export function demoPageTitle(page: string): string {
  return `${page} — College Portal demo · ${DEMO_COLLEGE_NAME}`;
}
