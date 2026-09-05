/**
 * In-memory holder for the short-lived dashboard-issued identity token.
 *
 * Kept as a module-level variable so it survives Home → MeetingRoom SPA
 * navigation but never touches localStorage/sessionStorage. Lost on page
 * reload — by design; the token is short-lived and re-issued on every
 * dashboard click. PeerMeet still works fully anonymously if none is set.
 */

let authToken = null;
let identityPrivate = false;

export function setAuthToken(token) {
  authToken = token || null;
}

export function getAuthToken() {
  return authToken;
}

export function clearAuthToken() {
  authToken = null;
}

/**
 * Dashboard-controlled privacy preference: when true, PeerMeet UI should
 * treat the peer's identity as "Anonymous Candidate" locally. Does NOT
 * change the JWT/webhook contracts — the backend still receives the real
 * student identity for persistence. In-memory only.
 */
export function setIdentityPrivate(value) {
  identityPrivate = !!value;
}

export function getIdentityPrivate() {
  return identityPrivate;
}
