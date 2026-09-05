/**
 * In-memory holder for the short-lived dashboard-issued identity token.
 *
 * Kept as a module-level variable so it survives Home → MeetingRoom SPA
 * navigation but never touches localStorage/sessionStorage. Lost on page
 * reload — by design; the token is short-lived and re-issued on every
 * dashboard click. PeerMeet still works fully anonymously if none is set.
 */

let authToken = null;

export function setAuthToken(token) {
  authToken = token || null;
}

export function getAuthToken() {
  return authToken;
}

export function clearAuthToken() {
  authToken = null;
}
